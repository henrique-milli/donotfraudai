package ch.attest.onboarding.scan

import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Point
import org.opencv.core.Rect
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Detects the ICAO eMRTD chip symbol (Doc 9303 Part 9): a landscape rectangle with a horizontal
 * band through its middle and a ring centred on it. Every chip-bearing ICAO document must carry it,
 * so its presence says the card has a contactless chip, before the holder is asked to tap anything.
 *
 * Two printed styles exist: filled (coloured rectangle, band and ring knocked out in white, as on the
 * Swiss residence permit) and outlined (dark strokes). Method, no model:
 *   1. multi-scale template matching (normalised cross-correlation) of both styles on the card
 *   2. geometric verification of each candidate: solid uniform fill, a band spanning the full width,
 *      light ring arcs with fill inside, contrast with the surroundings (rejects letters like "B" and
 *      two lines of text with a gap between them, which correlate well on their own)
 * Score = correlation × geometry. Validated on one card design (4 captures: symbol 0.31–0.71, same
 * card with the symbol removed ≤ 0.20, back side ≤ 0.04); threshold 0.25.
 */
object ChipSymbol {

    data class Result(val confidence: Double, val box: Rect?) {
        val found get() = confidence >= THRESHOLD
    }

    const val THRESHOLD = 0.25
    private const val WORK_W = 800.0
    private const val ASPECT = 1.57
    private const val MIN_CORR = 0.45

    private class Geom(w: Int) {
        val w = w
        val h = (w / ASPECT).roundToInt()
        val t = max(2, (h * 0.11).roundToInt())
        val r = (h * 0.30).roundToInt()
        val pad = (h * 0.25).roundToInt()
    }

    /** filled (+1: light strokes on dark fill) or outline (-1: dark strokes on light) */
    private fun template(g: Geom, filled: Boolean): Mat {
        val m = Mat(g.h + 2 * g.pad, g.w + 2 * g.pad, CvType.CV_8UC1, Scalar(220.0))
        val cy = g.pad + g.h / 2; val cx = g.pad + g.w / 2
        val tl = Point(g.pad.toDouble(), g.pad.toDouble()); val br = Point((g.pad + g.w - 1).toDouble(), (g.pad + g.h - 1).toDouble())
        if (filled) {
            Imgproc.rectangle(m, tl, br, Scalar(70.0), -1)
            Imgproc.rectangle(m, Point(g.pad.toDouble(), (cy - g.t / 2).toDouble()), Point((g.pad + g.w - 1).toDouble(), (cy + g.t / 2).toDouble()), Scalar(220.0), -1)
            Imgproc.circle(m, Point(cx.toDouble(), cy.toDouble()), g.r, Scalar(220.0), g.t)
        } else {
            Imgproc.rectangle(m, tl, br, Scalar(60.0), g.t)
            Imgproc.line(m, Point(g.pad.toDouble(), cy.toDouble()), Point((g.pad + g.w - 1).toDouble(), cy.toDouble()), Scalar(60.0), g.t)
            Imgproc.circle(m, Point(cx.toDouble(), cy.toDouble()), g.r, Scalar(60.0), g.t)
        }
        Imgproc.GaussianBlur(m, m, Size(3.0, 3.0), 0.0)
        return m
    }

    fun detect(card: Mat): Result {
        if (card.empty()) return Result(0.0, null)
        val scale = WORK_W / card.width()
        val small = Mat(); val gray = Mat()
        try {
            Imgproc.resize(card, small, Size(WORK_W, card.height() * scale))
            Imgproc.cvtColor(small, gray, if (small.channels() == 4) Imgproc.COLOR_BGRA2GRAY else Imgproc.COLOR_BGR2GRAY)
            Imgproc.GaussianBlur(gray, gray, Size(3.0, 3.0), 0.0)
            val px = ByteArray((gray.total() * gray.channels()).toInt()).also { gray.get(0, 0, it) }
            val img = Gray(px, gray.cols(), gray.rows())

            var best = 0.0
            var bestBox: Rect? = null
            for (step in 0 until 13) {
                val w = (WORK_W * (0.05 + step * (0.08 / 12))).toInt()
                val g = Geom(w)
                for (filled in listOf(true, false)) {
                    val tpl = template(g, filled)
                    if (tpl.rows() >= gray.rows() || tpl.cols() >= gray.cols()) { tpl.release(); continue }
                    val res = Mat()
                    Imgproc.matchTemplate(gray, tpl, res, Imgproc.TM_CCOEFF_NORMED)
                    repeat(3) { // top peaks per scale and style
                        val mm = Core.minMaxLoc(res)
                        if (mm.maxVal < MIN_CORR) return@repeat
                        val x = mm.maxLoc.x.toInt(); val y = mm.maxLoc.y.toInt()
                        val score = mm.maxVal * verify(img, x, y, g, if (filled) 1 else -1)
                        if (score > best) {
                            best = score
                            bestBox = Rect(((x + g.pad) / scale).toInt(), ((y + g.pad) / scale).toInt(), (g.w / scale).toInt(), (g.h / scale).toInt())
                        }
                        Imgproc.rectangle(res, Point((x - g.w / 2).toDouble(), (y - g.w / 3).toDouble()),
                            Point((x + g.w / 2).toDouble(), (y + g.w / 3).toDouble()), Scalar(-1.0), -1)
                    }
                    res.release(); tpl.release()
                }
            }
            return Result(best, bestBox)
        } finally {
            small.release(); gray.release()
        }
    }

    private class Gray(val px: ByteArray, val w: Int, val h: Int) {
        operator fun get(x: Int, y: Int): Double = (px[y * w + x].toInt() and 0xFF).toDouble()
        fun mean(x0: Int, y0: Int, x1: Int, y1: Int): Double {
            var s = 0.0; var n = 0
            for (y in y0 until y1) for (x in x0 until x1) { s += this[x, y]; n++ }
            return if (n == 0) 0.0 else s / n
        }
        fun std(x0: Int, y0: Int, x1: Int, y1: Int): Double {
            val m = mean(x0, y0, x1, y1); var s = 0.0; var n = 0
            for (y in y0 until y1) for (x in x0 until x1) { val d = this[x, y] - m; s += d * d; n++ }
            return if (n == 0) 0.0 else kotlin.math.sqrt(s / n)
        }
    }

    /** Geometric verification of a candidate (0..1), in the symbol's polarity. */
    private fun verify(img: Gray, x: Int, y: Int, g: Geom, pol: Int): Double {
        val X = x + g.pad; val Y = y + g.pad; val w = g.w; val h = g.h
        if (X < 0 || Y < 0 || X + w > img.w || Y + h > img.h) return 0.0
        val m = 2
        val cw = max(3, (w * 0.16).toInt()); val ch = max(3, (h * 0.20).toInt())
        val corners = listOf(
            intArrayOf(X + m, Y + m, X + m + cw, Y + m + ch), intArrayOf(X + w - m - cw, Y + m, X + w - m, Y + m + ch),
            intArrayOf(X + m, Y + h - m - ch, X + m + cw, Y + h - m), intArrayOf(X + w - m - cw, Y + h - m - ch, X + w - m, Y + h - m),
        )
        val fill = corners.map { img.mean(it[0], it[1], it[2], it[3]) }.average()

        // surroundings, on every side that lies inside the image
        val sides = ArrayList<Double>()
        if (Y - g.pad >= 0) sides += img.mean(X, Y - g.pad, X + w, Y - 1)
        if (Y + h + g.pad <= img.h) sides += img.mean(X, Y + h + 1, X + w, Y + h + g.pad)
        if (X - g.pad >= 0) sides += img.mean(X - g.pad, Y, X - 1, Y + h)
        if (X + w + g.pad <= img.w) sides += img.mean(X + w + 1, Y, X + w + g.pad, Y + h)
        if (sides.size < 2) return 0.0
        val sideC = sides.map { pol * (it - fill) }
        val spread = sideC.sorted().let { if (it.size % 2 == 1) it[it.size / 2] else (it[it.size / 2 - 1] + it[it.size / 2]) / 2 }
        if (spread < 18) return 0.0
        val sRect = sideC.count { it > 0.5 * spread }.toDouble() / sideC.size

        // 1. solid fill (text is textured)
        val sSolid = corners.count { img.std(it[0], it[1], it[2], it[3]) < 0.28 * spread }.toDouble() / corners.size

        // 2. band across the full width, outside the ring
        val cy = Y + h / 2; val cx = X + w / 2
        val half = max(1, g.t / 3)
        val cols = (X + m until X + w - m).filter { abs(it - cx) > g.r + g.t }
        val sBand = if (cols.isEmpty()) 0.0 else cols.count { c ->
            var s = 0.0; for (yy in cy - half..cy + half) s += img[c, yy]
            pol * (s / (2 * half + 1) - fill) > 0.4 * spread
        }.toDouble() / cols.size

        // 3. ring: light on the top and bottom arcs, fill just inside them
        val angles = (55..125 step 10) + (235..305 step 10)
        val ring = angles.mapNotNull { a ->
            val rad = Math.toRadians(a.toDouble())
            val yy = (cy + g.r * sin(rad)).toInt(); val xx = (cx + g.r * cos(rad)).toInt()
            if (yy in Y until Y + h && xx in X until X + w) img[xx, yy] else null
        }
        val sRing = if (ring.isEmpty()) 0.0 else ring.count { pol * (it - fill) > 0.4 * spread }.toDouble() / ring.size
        val inner = listOf(-0.62, 0.62).map { img[cx, (cy + it * g.r).toInt()] }
        val sInner = inner.count { abs(it - fill) < 0.45 * spread }.toDouble() / inner.size

        return sRect * sSolid * sBand * (0.5 + 0.5 * sRing) * (0.5 + 0.5 * sInner)
    }
}
