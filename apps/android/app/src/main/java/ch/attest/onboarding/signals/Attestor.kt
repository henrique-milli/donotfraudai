package ch.attest.onboarding.signals

import android.content.Context
import android.util.Base64
import android.util.Log
import ch.attest.onboarding.BuildConfig
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Outcome
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Calendar
import java.util.concurrent.TimeUnit

/** Everything the device can prove or report about itself for one session. */
class AttestationReport(
    val challenge: ByteArray,
    val keyAlias: String?,
    val chainDer: List<ByteArray>,
    val parsed: KeyAttestation.Parsed?,
    val strongBox: Boolean,
    val keyError: String?,
    val integrityToken: String?,
    val integrityError: String?,
    val profile: JSONObject,
    val checks: List<Check>,
    val millis: Long,
) {
    /** attestation section of the (encrypted) payload */
    fun toJson(): JSONObject = JSONObject().apply {
        put("challenge", b64(challenge))
        put("keyAttestation", JSONObject().apply {
            put("chain", JSONArray(chainDer.map { b64(it) }))
            put("strongBox", strongBox)
            put("error", keyError ?: JSONObject.NULL)
            parsed?.let { p ->
                put("deviceView", JSONObject().apply { // on-device parse; backend must re-verify from the chain
                    put("securityLevel", p.securityLevelName); put("attestationVersion", p.attestationVersion)
                    put("verifiedBoot", p.bootStateName); put("deviceLocked", p.deviceLocked ?: JSONObject.NULL)
                    put("osPatchLevel", p.osPatchLevel ?: JSONObject.NULL); put("vendorPatchLevel", p.vendorPatchLevel ?: JSONObject.NULL)
                    put("bootPatchLevel", p.bootPatchLevel ?: JSONObject.NULL); put("verifiedBootKey", p.verifiedBootKeySha256 ?: JSONObject.NULL)
                    put("appPackage", p.appPackage ?: JSONObject.NULL); put("appSigner", p.appSignerSha256 ?: JSONObject.NULL)
                })
            }
        })
        put("playIntegrity", JSONObject().apply {
            put("token", integrityToken ?: JSONObject.NULL) // opaque; decrypted by the backend via Google
            put("error", integrityError ?: JSONObject.NULL)
        })
        put("profile", profile)
        put("collectMillis", millis)
    }

    companion object {
        fun b64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)
    }
}

object Attestor {
    private const val TAG = "AttestDevice"

    @android.annotation.SuppressLint("PrivateApi")
    private fun sysProp(key: String): String = runCatching {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, key) as String
    }.getOrDefault("")

    private fun fetchChallenge(): ByteArray? {
        if (BuildConfig.BACKEND_BASE.isBlank()) return null
        return runCatching {
            val c = java.net.URL("${BuildConfig.BACKEND_BASE}/challenges").openConnection() as java.net.HttpURLConnection
            c.requestMethod = "POST"; c.connectTimeout = 3000; c.readTimeout = 3000
            val body = c.inputStream.bufferedReader().readText().also { c.disconnect() }
            Base64.decode(JSONObject(body).getString("challenge"), Base64.DEFAULT).takeIf { it.size >= 16 }
        }.onFailure { Log.w(TAG, "challenge fetch failed: ${it.javaClass.simpleName}") }.getOrNull()
    }

    /** Blocking (key generation + Play Integrity round trip); run off the main thread. */
    fun collect(ctx: Context, sessionId: String): AttestationReport {
        val t0 = System.currentTimeMillis()
        // The backend issues a single-use challenge per session, so an attestation replayed from
        // another session or device fails. Offline: generated locally (and reported as such).
        val server = fetchChallenge()
        val challenge = server ?: ByteArray(32).also { SecureRandom().nextBytes(it) }
        val g = Group.DEVICE
        val checks = ArrayList<Check>()

        // --- hardware key attestation
        val alias = "attest-session-$sessionId"
        var chain = emptyList<java.security.cert.X509Certificate>()
        var parsed: KeyAttestation.Parsed? = null
        var strongBox = false
        var keyError: String? = null
        try {
            val r = KeyAttestation.generate(alias, challenge)
            chain = r.chain; strongBox = r.strongBox
            parsed = KeyAttestation.parse(chain.first())
        } catch (e: Exception) {
            keyError = "${e.javaClass.simpleName}: ${e.message}".take(160)
            Log.w(TAG, "key attestation failed", e)
        }

        if (parsed == null) {
            checks += Check(g, null, "Hardware key attestation", Outcome.WARN, keyError ?: "no attestation extension",
                "key generated and attested in secure hardware", risk = 15,
                why = "The phone could not prove its integrity with a hardware-attested key")
        } else {
            val p = parsed
            val hw = p.securityLevel >= 1
            checks += Check(g, null, "Hardware key attestation", if (hw) Outcome.PASS else Outcome.WARN,
                "${p.securityLevelName} · attestation v${p.attestationVersion} · ${chain.size} certs",
                "key lives in TEE / StrongBox", risk = 25,
                why = "The attestation key is software-only, so its claims cannot be trusted")
            val bootOk = p.verifiedBootState == 0 && p.deviceLocked == true
            checks += Check(g, null, "Verified boot", if (bootOk) Outcome.PASS else Outcome.WARN,
                "${p.bootStateName} · bootloader ${if (p.deviceLocked == true) "locked" else "unlocked"}",
                "state Verified and bootloader locked", risk = 35,
                why = "Bootloader unlocked or custom OS, so the operating system itself cannot be trusted")
            // the OS can be made to lie about boot state (Magisk resetprop); the secure hardware cannot
            val osState = sysProp("ro.boot.verifiedbootstate")
            val osLocked = sysProp("ro.boot.flash.locked") == "1" || sysProp("ro.boot.vbmeta.device_state") == "locked"
            val spoofed = !bootOk && (osState == "green" || osLocked)
            checks += Check(g, null, "Boot state consistency", if (spoofed) Outcome.WARN else Outcome.PASS,
                if (spoofed) "OS reports $osState/${if (osLocked) "locked" else "unlocked"} · hardware attests ${p.bootStateName}/${if (p.deviceLocked == true) "locked" else "unlocked"}"
                else "OS properties agree with the attestation",
                "OS boot properties = hardware-attested state", risk = 40,
                why = "Root is being actively hidden: the OS claims a locked bootloader, the secure hardware says it is unlocked")
            val bound = p.challenge.contentEquals(challenge)
            checks += Check(g, null, "Session challenge bound", if (bound) Outcome.PASS else Outcome.FAIL,
                if (bound) "attestation carries this session's challenge" else "challenge mismatch", "prevents replaying another device's attestation",
                risk = 60, why = "The attestation was not made for this session (replay)")
            val intact = KeyAttestation.chainIntact(chain)
            checks += Check(g, null, "Certificate chain", if (intact) Outcome.PASS else Outcome.WARN,
                if (intact) "each certificate signed by the next · root verified server-side" else "broken signature in chain",
                "chain intact; Google root + revocation checked by backend", risk = 20,
                why = "The attestation certificate chain is broken")
            p.osPatchLevel?.let { lvl ->
                val now = Calendar.getInstance().let { it.get(Calendar.YEAR) * 12 + it.get(Calendar.MONTH) + 1 }
                val age = now - ((lvl / 100) * 12 + lvl % 100)
                checks += Check(g, null, "Security patch (attested)", if (age > 18) Outcome.WARN else Outcome.PASS,
                    "%04d-%02d · %d months old".format(lvl / 100, lvl % 100, age), "≤ 18 months", risk = 5,
                    why = "The OS security patch is more than 18 months old")
            }
        }

        // --- Play Integrity (optional; the token is opaque to the app and decoded by the backend)
        var token: String? = null
        var integrityError: String? = null
        try {
            val nonce = Base64.encodeToString(challenge, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            val req = IntegrityTokenRequest.builder().setNonce(nonce).apply {
                if (BuildConfig.PLAY_CLOUD_PROJECT > 0) setCloudProjectNumber(BuildConfig.PLAY_CLOUD_PROJECT)
            }.build()
            token = Tasks.await(IntegrityManagerFactory.create(ctx).requestIntegrityToken(req), 10, TimeUnit.SECONDS).token()
        } catch (e: Exception) {
            integrityError = (e.cause ?: e).let { "${it.javaClass.simpleName}: ${it.message}" }.take(160)
            Log.w(TAG, "Play Integrity unavailable: $integrityError")
        }
        checks += Check(g, null, "Attestation challenge", Outcome.INFO,
            if (server != null) "issued by the risk backend" else "generated on device (backend unreachable)",
            "single-use, verified server-side")
        checks += Check(g, null, "Play Integrity token", Outcome.INFO,
            if (token != null) "attached · ${token.length} chars · verdict decoded by backend" else "not available · ${integrityError?.substringBefore(':')}",
            "requires Play distribution + cloud project in production")

        val profile = DeviceProfile.collect(ctx)
        checks += profile.checks
        checks.filter { it.outcome != Outcome.PASS }.forEach { Log.i(TAG, "${it.outcome} ${it.label}: ${it.value}") }
        return AttestationReport(
            challenge, if (parsed != null || chain.isNotEmpty()) alias else null, chain.map { it.encoded }, parsed, strongBox, keyError,
            token, integrityError, profile.json, checks, System.currentTimeMillis() - t0,
        )
    }
}
