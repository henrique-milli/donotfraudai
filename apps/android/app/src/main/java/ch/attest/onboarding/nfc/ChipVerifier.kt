package ch.attest.onboarding.nfc

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import ch.digitaltrust.engine.ChipData
import ch.digitaltrust.engine.Frames
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.ChipReport
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Mrz
import ch.attest.onboarding.core.MrzParser
import ch.attest.onboarding.core.Outcome
import org.bouncycastle.cms.CMSSignedData
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.DG2File
import java.io.ByteArrayInputStream
import java.security.MessageDigest

/**
 * Standard ICAO 9303 checks on data read from the chip by the scanning engine's chip reader
 * (PACE with BAC fallback, DG14 Chip Authentication):
 *
 *  - DG1 (chip MRZ) must match the MRZ printed on the card
 *  - Passive Authentication: DG1/DG2 hashes must match the Document Security Object (SOD), and
 *    the SOD's CMS signature must verify against its embedded Document Signer certificate
 *
 * Not done on device: chaining the Document Signer to the Swiss CSCA. That needs the Swiss
 * CSCA certificate / ICAO master list, which is not bundled — a server-side step.
 */
object ChipVerifier {
    private val g = Group.CHIP
    private val bc = BouncyCastleProvider()

    fun verify(data: ChipData, printed: Mrz): ChipReport {
        val out = ArrayList<Check>()
        out += Check(g, null, "Chip access (PACE / BAC)", Outcome.PASS, "secure channel established", "access key from printed MRZ")

        // --- DG1 vs printed MRZ
        var chipMrz: Mrz? = null
        try {
            val info = DG1File(ByteArrayInputStream(data.dg1)).mrzInfo
            val lines = info.toString().trim().lines().map { it.trim() }.filter { it.isNotEmpty() }
            chipMrz = if (lines.size >= 3) MrzParser.parse(lines[0], lines[1], lines[2]) else null
            val mismatches = buildList {
                if (info.documentNumber.trimEnd('<') != printed.documentNumber) add("document number")
                if (info.dateOfBirth != printed.dateOfBirth) add("date of birth")
                if (info.dateOfExpiry != printed.dateOfExpiry) add("date of expiry")
                if (info.issuingState.trimEnd('<') != printed.issuingState) add("issuing state")
            }
            out += Check(
                g, null, "Chip MRZ matches printed MRZ",
                if (mismatches.isEmpty()) Outcome.PASS else Outcome.FAIL,
                if (mismatches.isEmpty()) "DG1 = card" else "differs: " + mismatches.joinToString(),
                "DG1 must equal the printed TD1 MRZ", risk = 80,
                why = "The chip data does not match the printed card: the print was altered",
            )
        } catch (e: Exception) {
            out += Check(g, null, "Chip MRZ (DG1)", Outcome.FAIL, "could not parse: ${e.javaClass.simpleName}", "DG1 required", risk = 50,
                why = "The chip's MRZ could not be parsed")
        }

        // --- Passive Authentication: hashes
        try {
            val sod = SODFile(ByteArrayInputStream(data.sod))
            val alg = sod.digestAlgorithm
            val md = MessageDigest.getInstance(alg)
            val stored = sod.dataGroupHashes
            val groups = listOf(1 to data.dg1, 2 to data.dg2, 11 to data.dg11, 12 to data.dg12, 14 to data.dg14)
                .filter { (_, b) -> b.isNotEmpty() }
            val bad = groups.filter { (n, b) -> stored[n]?.let { !md.digest(b).contentEquals(it) } ?: true }.map { "DG${it.first}" }
            out += Check(
                g, null, "Data-group integrity",
                if (bad.isEmpty()) Outcome.PASS else Outcome.FAIL,
                if (bad.isEmpty()) groups.joinToString(" · ") { "DG${it.first}" } + " · $alg" else "hash mismatch: ${bad.joinToString()}",
                "hash of each DG read must equal the SOD", risk = 90,
                why = "Chip data was modified after issuance (hash mismatch)",
            )

            // --- Passive Authentication: Document Signer signature over the SOD
            val ds = sod.docSigningCertificate
            val signed = CMSSignedData(stripSodTag(data.sod))
            val signer = signed.signerInfos.signers.first()
            val sigOk = signer.verify(JcaSimpleSignerInfoVerifierBuilder().setProvider(bc).build(ds))
            out += Check(
                g, null, "SOD signature (Document Signer)",
                if (sigOk) Outcome.PASS else Outcome.FAIL,
                ds.subjectX500Principal.name.substringAfter("CN=").substringBefore(",").ifBlank { "Document Signer" },
                "CMS signature verifies with embedded DS certificate", risk = 90,
                why = "The chip's issuer signature does not verify",
            )
            val dsValid = runCatching { ds.checkValidity() }.isSuccess
            out += Check(g, null, "Document Signer validity", if (dsValid) Outcome.PASS else Outcome.INFO,
                "${ds.notBefore.format()} – ${ds.notAfter.format()}", "informational")
            out += Check(g, null, "Chain to Swiss CSCA", Outcome.SKIPPED, "Swiss CSCA master list not bundled", "server-side step")
        } catch (e: Exception) {
            out += Check(g, null, "Passive Authentication", Outcome.FAIL, "${e.javaClass.simpleName}: ${e.message ?: ""}".take(90), "SOD must parse and verify", risk = 70,
                why = "Passive Authentication failed")
        }

        out += Check(
            g, null, "Chip Authentication (DG14)",
            if (data.dg14.isNotEmpty()) Outcome.PASS else Outcome.INFO,
            if (data.dg14.isNotEmpty()) "DG14 present — EAC-CA performed by reader" else "not supported by this chip",
            "anti-cloning",
        )

        // --- DG2 face
        var face: Bitmap? = null
        try {
            val img = DG2File(ByteArrayInputStream(data.dg2)).faceInfos.firstOrNull()?.faceImageInfos?.firstOrNull()
            if (img != null) {
                val bytes = img.imageInputStream.readBytes()
                face = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: Frames.decode(bytes)?.let { m -> Frames.toBitmap(m).also { m.release() } } // JPEG 2000 via OpenCV
                out += Check(g, null, "Holder photo (DG2)", if (face != null) Outcome.PASS else Outcome.INFO,
                    "${img.mimeType} · ${bytes.size / 1024} KB" + if (face == null) " · not decodable on device" else "", "ISO/IEC 19794-5")
            }
        } catch (e: Exception) {
            out += Check(g, null, "Holder photo (DG2)", Outcome.INFO, "not parsed: ${e.javaClass.simpleName}", "ISO/IEC 19794-5")
        }
        return ChipReport(out, face, chipMrz)
    }

    /** EF.SOD is wrapped in application tag 0x77; the CMS ContentInfo is its value. */
    private fun stripSodTag(sod: ByteArray): ByteArray {
        if (sod.isEmpty() || (sod[0].toInt() and 0xFF) != 0x77) return sod
        val l = sod[1].toInt() and 0xFF
        val (len, off) = when {
            l < 0x80 -> l to 2
            l == 0x81 -> (sod[2].toInt() and 0xFF) to 3
            l == 0x82 -> (((sod[2].toInt() and 0xFF) shl 8) or (sod[3].toInt() and 0xFF)) to 4
            l == 0x83 -> (((sod[2].toInt() and 0xFF) shl 16) or ((sod[3].toInt() and 0xFF) shl 8) or (sod[4].toInt() and 0xFF)) to 5
            else -> return sod
        }
        return sod.copyOfRange(off, minOf(sod.size, off + len))
    }

    private fun java.util.Date.format() = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(this)
}
