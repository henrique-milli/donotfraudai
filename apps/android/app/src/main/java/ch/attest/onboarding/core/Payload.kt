package ch.attest.onboarding.core

import android.content.Context
import android.util.Base64
import android.util.Log
import ch.attest.onboarding.BuildConfig
import ch.attest.onboarding.signals.KeyAttestation
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The session as the risk backend receives it: every signal with its score contribution, capture
 * telemetry, chip evidence, the device attestation and the evidence images (card sides, ID
 * portrait, chip photo) as JPEG. Images sit inside the signed payload, so the backend can prove
 * they came from this device in this session and were not swapped in transit.
 *
 * Delivery: payload → signed with the session's hardware-attested key → sealed with [Envelope] to
 * the backend public key → outbox → POST (when BACKEND_BASE is set). The applicant sees none of it.
 */
object Payload {
    private const val TAG = "AttestPayload"

    fun build(withImages: Boolean = true): JSONObject {
        val all = Session.allChecks()
        val v = Session.verdict(all)
        return JSONObject().apply {
            put("session", Session.id)
            put("startedAt", Session.startedAt)
            put("sealedAt", System.currentTimeMillis())
            put("app", "${BuildConfig.APPLICATION_ID} ${BuildConfig.VERSION_NAME}")
            put("mode", if (Mode.stage) "stage" else "prod")
            put("document", Session.selected.name)
            // identity as read: chip DG1 when verified, else the printed MRZ
            (Session.chip?.chipMrz ?: Session.mrz)?.let { m ->
                put("holder", JSONObject().apply {
                    put("givenNames", m.givenNames); put("surname", m.surname)
                    put("documentNumber", m.documentNumber); put("documentCode", m.documentCode)
                    put("issuingState", m.issuingState); put("nationality", m.nationality); put("sex", m.sex)
                    put("dateOfBirth", m.dateOfBirth); put("dateOfExpiry", m.dateOfExpiry)
                    put("source", if (Session.chip?.chipMrz != null) "CHIP" else "MRZ")
                })
            }
            put("deviceVerdict", JSONObject().apply { // advisory: the backend decides
                put("verdict", v.name)
                put("assurance", Session.assurance(v).name)
                put("riskScore", Session.riskScore(all))
            })
            put("chip", JSONObject().apply {
                put("symbol", JSONObject(Session.chipSymbol.mapKeys { it.key.name } as Map<*, *>))
                Session.chipDecision?.let { d ->
                    put("expectation", d.expectation.name); put("reason", d.reason)
                    put("enforced", d.enforced); put("phoneNfc", d.phoneCanRead); put("phoneNfcOn", d.phoneNfcOn)
                }
                put("read", Session.chip != null)
                put("attempts", Session.chipAttempts)
                put("skippedReason", Session.chipSkippedReason ?: JSONObject.NULL)
            })
            put("signals", JSONArray().apply {
                all.forEach { c ->
                    put(JSONObject().apply {
                        put("group", c.group.name)
                        put("side", c.side?.name ?: JSONObject.NULL)
                        put("signal", c.label)
                        put("outcome", c.outcome.name)
                        put("value", c.value)
                        put("rule", c.rule)
                        put("riskPoints", c.points)
                    })
                }
            })
            put("telemetry", JSONObject().apply {
                Session.telemetry.forEach { (side, t) ->
                    put(side.name, JSONObject().apply {
                        put("seconds", if (t.seconds.isNaN()) JSONObject.NULL else t.seconds)
                        put("frames", t.frames)
                        put("hints", JSONObject(t.hints as Map<*, *>))
                        put("gyroRms", if (t.gyroRms.isNaN()) JSONObject.NULL else t.gyroRms)
                        put("accelStd", if (t.accelStd.isNaN()) JSONObject.NULL else t.accelStd)
                    })
                }
            })
            put("attestation", Session.attestation?.toJson() ?: JSONObject.NULL)
            put("resumeToken", Session.resumeToken)
            Session.face?.let { f -> put("face", faceJson(f)) }
            if (withImages) put("images", images())
        }
    }

    /** Downscaled JPEG as {mime, width, height, b64}. */
    private fun jpeg(bmp: android.graphics.Bitmap, maxW: Int, q: Int): JSONObject {
        val scaled = if (bmp.width > maxW) android.graphics.Bitmap.createScaledBitmap(bmp, maxW, bmp.height * maxW / bmp.width, true) else bmp
        val out = java.io.ByteArrayOutputStream()
        scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, q, out)
        return JSONObject().apply {
            put("mime", "image/jpeg"); put("width", scaled.width); put("height", scaled.height)
            put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        }
    }

    private fun faceJson(f: FaceCapture) = JSONObject().apply {
        put("mode", f.mode)
        put("challenge", f.challenge ?: JSONObject.NULL)
        put("gestures", JSONArray().apply {
            f.gestures.forEachIndexed { i, g -> put(JSONObject().apply { put("gesture", g); put("frame", "active${i + 1}") }) }
        })
    }

    private fun faceImages(o: JSONObject, f: FaceCapture) {
        o.put("selfie", jpeg(f.selfie, 720, 90))
        val prefix = if (f.mode == "ACTIVE") "active" else "burst"
        f.frames.take(if (f.mode == "ACTIVE") 6 else 4).forEachIndexed { i, b -> o.put("$prefix${i + 1}", jpeg(b, 480, 85)) }
    }

    /** kind → {mime, b64}. Card sides downscaled to 1200 px wide; portraits kept small. */
    private fun images(): JSONObject = JSONObject().apply {
        fun add(kind: String, bmp: android.graphics.Bitmap?, maxW: Int, q: Int) { bmp?.let { put(kind, jpeg(it, maxW, q)) } }
        val front = Session.front
        add("front", front?.document, 1200, 82)
        add("back", Session.back?.document, 1200, 82)
        // printed ID portrait, cropped with a margin around the detected face
        if (front != null && front.face != null) {
            val f = front.face; val d = front.document
            val mx = f.width() / 4; val my = f.height() / 4
            val r = android.graphics.Rect((f.left - mx).coerceAtLeast(0), (f.top - my).coerceAtLeast(0),
                (f.right + mx).coerceAtMost(d.width), (f.bottom + my).coerceAtMost(d.height))
            if (r.width() > 8 && r.height() > 8) add("portrait", android.graphics.Bitmap.createBitmap(d, r.left, r.top, r.width(), r.height()), 480, 88)
        }
        add("chipPhoto", Session.chip?.face, 480, 88) // DG2, the issuer's own copy of the photo
        Session.face?.let { faceImages(this, it) }
    }

    class Sealed(
        val file: File,
        val plainBytes: Int,
        val sealedBytes: Int,
        /** security level of the key that signed the payload, or null if unsigned */
        val signedBy: String?,
        val delivery: String,
        /** CONTINUE / STEP_UP / MANUAL_REVIEW from the backend, null when not delivered */
        val route: String?,
    )

    /** Blocking (signing + optional network); call off the main thread. */
    fun seal(ctx: Context): Sealed? = runCatching {
        val att = Session.attestation
        sealAndSend(ctx, Session.id, build().toString(), att) { build(withImages = false).toString(2) }
    }.onFailure { Log.e(TAG, "could not seal payload", it) }.getOrNull()

    /** Where the phone stands with the backend for a session it submitted. */
    class Pending(val parentSession: String, val token: String, val number: Int, val steps: List<String>)

    /**
     * Active-liveness result for [p]: its own hardware-attested key (fresh server challenge), the
     * neutral selfie and one frame per requested gesture, signed and sealed like a session.
     */
    fun sealReverification(ctx: Context, p: Pending, capture: FaceCapture): Sealed? = runCatching {
        val id = "RV" + java.util.UUID.randomUUID().toString().take(6).uppercase()
        val att = ch.attest.onboarding.signals.Attestor.collect(ctx, id)
        val payload = JSONObject().apply {
            put("kind", "reverification"); put("session", id); put("parentSession", p.parentSession)
            put("reverification", p.number); put("resumeToken", p.token)
            put("sealedAt", System.currentTimeMillis())
            put("app", "${BuildConfig.APPLICATION_ID} ${BuildConfig.VERSION_NAME}")
            put("face", faceJson(capture))
            put("signals", JSONArray().apply { capture.checks.forEach { put(signalJson(it)) } })
            put("attestation", att.toJson())
            put("images", JSONObject().apply { faceImages(this, capture) })
        }
        sealAndSend(ctx, id, payload.toString(), att) { payload.apply { remove("images") }.toString(2) }
    }.onFailure { Log.e(TAG, "could not seal re-verification", it) }.getOrNull()

    private fun signalJson(c: Check) = JSONObject().apply {
        put("group", c.group.name); put("side", c.side?.name ?: JSONObject.NULL); put("signal", c.label)
        put("outcome", c.outcome.name); put("value", c.value); put("rule", c.rule); put("riskPoints", c.points)
    }

    private fun sealAndSend(
        ctx: Context, id: String, payload: String, att: ch.attest.onboarding.signals.AttestationReport?, debugCopy: () -> String,
    ): Sealed {
        val sig = att?.keyAlias?.let { alias -> runCatching { KeyAttestation.sign(alias, payload.toByteArray()) }.getOrNull() }
        val body = JSONObject().apply {
            put("payload", payload) // signed bytes, verbatim
            put("sig", sig?.let { b64(it) } ?: JSONObject.NULL)
            put("sigAlg", "SHA256withECDSA")
            put("signer", "payload.attestation.keyAttestation.chain[0]")
        }.toString().toByteArray()
        check(BuildConfig.BACKEND_PUBKEY.isNotBlank()) { "no backend key: run scripts/fetch-backend-key.sh, then rebuild" }
        val sealed = Envelope.seal(body, Envelope.publicKey(Base64.decode(BuildConfig.BACKEND_PUBKEY, Base64.DEFAULT)), BuildConfig.BACKEND_KID)
        val envelope = JSONObject().apply {
            put("v", 1); put("alg", Envelope.ALG); put("kid", sealed.kid); put("session", id)
            put("epk", b64(sealed.epk)); put("iv", b64(sealed.iv)); put("ct", b64(sealed.ct))
        }.toString()

        val dir = File(ctx.filesDir, "outbox").apply { mkdirs() }
        val file = File(dir, "$id.sealed.json").apply { writeText(envelope) }
        // plaintext copy only in debug builds, for inspection during development
        if (BuildConfig.DEBUG) File(dir, "$id.plain.json").writeText(debugCopy())
        att?.keyAlias?.let { KeyAttestation.delete(it) } // one key per envelope

        val (delivery, route) = if (BuildConfig.BACKEND_BASE.isBlank()) "queued offline (no backend configured)" to null else upload(envelope)
        Log.i(TAG, "$id sealed ${payload.length}→${envelope.length} B, signed=${sig != null}, $delivery: ${file.absolutePath}")
        return Sealed(file, payload.length, envelope.length, att?.parsed?.securityLevelName?.takeIf { sig != null }, delivery, route)
    }

    /** The backend answers with the route only (CONTINUE / STEP_UP / MANUAL_REVIEW), never reasons. */
    private fun upload(envelope: String): Pair<String, String?> = runCatching {
        val c = URL("${BuildConfig.BACKEND_BASE}/sessions").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 8000; c.readTimeout = 30000
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(envelope.toByteArray()) }
        val code = c.responseCode
        val route = runCatching { JSONObject(c.inputStream.bufferedReader().readText()).optString("route") }.getOrNull()
        c.disconnect()
        if (code in 200..299) "delivered · backend route ${route ?: "?"}" to route else "backend refused (HTTP $code), kept in outbox" to null
    }.getOrElse { "backend unreachable (${it.javaClass.simpleName}), kept in outbox" to null }

    /**
     * Asks the backend whether this session needs anything else (active liveness). Blocking.
     * The resume token proves ownership; the answer never carries the reasons.
     */
    fun next(sessionId: String, token: String): Pending? = runCatching {
        if (BuildConfig.BACKEND_BASE.isBlank()) return null
        val c = URL("${BuildConfig.BACKEND_BASE}/sessions/$sessionId/next").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = 8000
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
        if (c.responseCode != 200) return null
        val j = JSONObject(c.inputStream.bufferedReader().readText()).also { c.disconnect() }
        if (j.optString("action") != "ACTIVE_LIVENESS") return null
        val steps = j.getJSONArray("steps").let { a -> List(a.length()) { a.getString(it) } }
        Pending(sessionId, token, j.getInt("reverification"), steps)
    }.onFailure { Log.w(TAG, "next-action check failed: ${it.javaClass.simpleName}") }.getOrNull()

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
}
