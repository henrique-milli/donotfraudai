package ch.attest.onboarding.core

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Hybrid public-key encryption of the session payload to the risk backend (ECIES-style, plain JCA):
 *
 *   ephemeral P-256 key  ─ECDH─►  shared secret  ─HKDF-SHA256(info="attest/payload/v1")─►  AES-256 key
 *   AES-256-GCM(key, random 96-bit IV, AAD = "attest|v1|<kid>")  →  ciphertext ‖ 128-bit tag
 *
 * Only the holder of the backend private key can read it; the GCM tag makes any tampering fatal.
 * A fresh ephemeral key per payload gives forward secrecy on the device side. [kid] names the
 * backend key so it can be rotated.
 */
object Envelope {
    const val ALG = "ECDH-ES-P256+HKDF-SHA256+A256GCM"
    private const val INFO = "attest/payload/v1"

    class Sealed(val kid: String, val epk: ByteArray, val iv: ByteArray, val ct: ByteArray)

    fun aad(kid: String) = "attest|v1|$kid".toByteArray()

    fun publicKey(spki: ByteArray): PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))

    fun seal(plaintext: ByteArray, recipient: PublicKey, kid: String, rnd: SecureRandom = SecureRandom()): Sealed {
        val eph = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), rnd) }.generateKeyPair()
        val key = derive(eph.private, recipient)
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            updateAAD(aad(kid))
        }
        return Sealed(kid, eph.public.encoded, iv, c.doFinal(plaintext))
    }

    /** Backend side (also used by the tests). */
    fun open(s: Sealed, recipient: PrivateKey): ByteArray {
        val key = derive(recipient, publicKey(s.epk))
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, s.iv))
            updateAAD(aad(s.kid))
            doFinal(s.ct)
        }
    }

    private fun derive(priv: PrivateKey, pub: PublicKey): ByteArray {
        val shared = KeyAgreement.getInstance("ECDH").run { init(priv); doPhase(pub, true); generateSecret() }
        return hkdf(shared, salt = ByteArray(32), info = INFO.toByteArray(), len = 32)
    }

    /** RFC 5869 HKDF-SHA256. */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, len: Int): ByteArray {
        val prk = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(salt, "HmacSHA256")); doFinal(ikm) }
        val out = java.io.ByteArrayOutputStream()
        var t = ByteArray(0)
        var i = 1
        while (out.size() < len) {
            t = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(prk, "HmacSHA256")); update(t); update(info); update(i.toByte()); doFinal() }
            out.write(t); i++
        }
        return out.toByteArray().copyOf(len)
    }
}
