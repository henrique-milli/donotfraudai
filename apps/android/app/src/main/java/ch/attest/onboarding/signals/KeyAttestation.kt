package ch.attest.onboarding.signals

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.bouncycastle.asn1.ASN1Boolean
import org.bouncycastle.asn1.ASN1Encodable
import org.bouncycastle.asn1.ASN1Enumerated
import org.bouncycastle.asn1.ASN1Integer
import org.bouncycastle.asn1.ASN1OctetString
import org.bouncycastle.asn1.ASN1Sequence
import org.bouncycastle.asn1.ASN1Set
import org.bouncycastle.asn1.ASN1TaggedObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec

/**
 * Android hardware key attestation. A fresh P-256 key is generated inside the phone's secure
 * hardware (StrongBox if present, else the TEE) with the session challenge baked in. Its
 * certificate chain, signed by a Google-rooted device key, states what the secure hardware saw at
 * boot: verified-boot state, bootloader lock, OS patch level, and which app asked for the key.
 *
 * The same key signs the session payload, binding every signal to this device and this session.
 * On-device parsing is for display only; the backend must verify the chain to Google's roots and
 * the revocation list before trusting any field.
 */
object KeyAttestation {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val OID = "1.3.6.1.4.1.11129.2.1.17"

    data class Parsed(
        val attestationVersion: Int,
        val securityLevel: Int,
        val keymasterVersion: Int,
        val challenge: ByteArray,
        val deviceLocked: Boolean?,
        val verifiedBootState: Int?,
        val verifiedBootKeySha256: String?,
        val osVersion: Int?,
        val osPatchLevel: Int?,
        val vendorPatchLevel: Int?,
        val bootPatchLevel: Int?,
        val appPackage: String?,
        val appSignerSha256: String?,
    ) {
        val securityLevelName get() = level(securityLevel)
        val bootStateName get() = when (verifiedBootState) {
            0 -> "Verified"; 1 -> "SelfSigned"; 2 -> "Unverified"; 3 -> "Failed"; else -> "unknown"
        }
    }

    fun level(l: Int) = when (l) { 0 -> "Software"; 1 -> "TEE"; 2 -> "StrongBox"; else -> "unknown($l)" }

    class Result(val alias: String, val chain: List<X509Certificate>, val strongBox: Boolean)

    /** Generates the attested key. Tries StrongBox first, falls back to the TEE. */
    fun generate(alias: String, challenge: ByteArray): Result {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (ks.containsAlias(alias)) ks.deleteEntry(alias)
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .apply { if (strongBox && Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true) }
            .build()
        var strong = Build.VERSION.SDK_INT >= 28
        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).apply { initialize(spec(strong)) }.generateKeyPair()
        } catch (e: Exception) {
            if (!strong) throw e
            strong = false // StrongBoxUnavailableException or similar
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).apply { initialize(spec(false)) }.generateKeyPair()
        }
        val chain = ks.getCertificateChain(alias).map { it as X509Certificate }
        return Result(alias, chain, strong)
    }

    fun sign(alias: String, data: ByteArray): ByteArray {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val key = ks.getKey(alias, null) as PrivateKey
        return Signature.getInstance("SHA256withECDSA").run { initSign(key); update(data); sign() }
    }

    fun delete(alias: String) = runCatching {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias)
    }

    /** Each certificate must be signed by the next one. (Root-of-trust check happens server-side.) */
    fun chainIntact(chain: List<X509Certificate>): Boolean = chain.size >= 2 && chain.zipWithNext().all { (c, issuer) ->
        runCatching { c.verify(issuer.publicKey); true }.getOrDefault(false)
    }

    fun parse(leaf: X509Certificate): Parsed? {
        val ext = leaf.getExtensionValue(OID) ?: return null
        val seq = ASN1Sequence.getInstance(ASN1OctetString.getInstance(ext).octets)
        fun int(e: ASN1Encodable) = when (e) {
            is ASN1Integer -> e.value.toInt()
            is ASN1Enumerated -> e.value.toInt()
            else -> -1
        }
        val sw = ASN1Sequence.getInstance(seq.getObjectAt(6))
        val hw = ASN1Sequence.getInstance(seq.getObjectAt(7))
        fun find(list: ASN1Sequence, tag: Int): ASN1Encodable? =
            list.objects.toList().map { it as ASN1TaggedObject }.firstOrNull { it.tagNo == tag }?.explicitBaseObject
        fun findAny(tag: Int) = find(hw, tag) ?: find(sw, tag)

        var locked: Boolean? = null; var state: Int? = null; var bootKey: String? = null
        (find(hw, 704) as? ASN1Sequence)?.let { rot ->
            bootKey = sha256(ASN1OctetString.getInstance(rot.getObjectAt(0)).octets).take(16)
            locked = ASN1Boolean.getInstance(rot.getObjectAt(1)).isTrue
            state = int(rot.getObjectAt(2))
        }
        var pkg: String? = null; var signer: String? = null
        (findAny(709) as? ASN1OctetString)?.let { oct ->
            runCatching {
                val app = ASN1Sequence.getInstance(oct.octets)
                val infos = ASN1Set.getInstance(app.getObjectAt(0))
                pkg = infos.firstOrNull()?.let { String(ASN1OctetString.getInstance(ASN1Sequence.getInstance(it).getObjectAt(0)).octets) }
                val digests = ASN1Set.getInstance(app.getObjectAt(1))
                signer = digests.firstOrNull()?.let { ASN1OctetString.getInstance(it).octets.joinToString("") { b -> "%02x".format(b) } }
            }
        }
        return Parsed(
            attestationVersion = int(seq.getObjectAt(0)),
            securityLevel = int(seq.getObjectAt(1)),
            keymasterVersion = int(seq.getObjectAt(2)),
            challenge = ASN1OctetString.getInstance(seq.getObjectAt(4)).octets,
            deviceLocked = locked,
            verifiedBootState = state,
            verifiedBootKeySha256 = bootKey,
            osVersion = findAny(705)?.let { int(it) },
            osPatchLevel = findAny(706)?.let { int(it) },
            vendorPatchLevel = findAny(718)?.let { int(it) },
            bootPatchLevel = findAny(719)?.let { int(it) },
            appPackage = pkg,
            appSignerSha256 = signer,
        )
    }

    fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
}
