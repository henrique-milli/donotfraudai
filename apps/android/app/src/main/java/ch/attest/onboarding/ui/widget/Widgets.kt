package ch.attest.onboarding.ui.widget

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Indeterminate loader: a single arc chasing itself. */
class ArcSpinner @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val d = resources.displayMetrics.density
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d; color = Color.parseColor("#33FFFFFF") }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d; strokeCap = Paint.Cap.ROUND; color = Color.WHITE }
    private val box = RectF()
    private var t = 0f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1200; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
        addUpdateListener { t = it.animatedValue as Float; invalidate() }
    }

    fun tint(color: Int, trackColor: Int) { arc.color = color; track.color = trackColor; invalidate() }

    // animate only while actually visible (a hidden spinner must not keep the UI thread busy)
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (isVisible) { if (!anim.isStarted) anim.start() } else anim.cancel()
    }
    override fun onDetachedFromWindow() { anim.cancel(); super.onDetachedFromWindow() }

    override fun onDraw(c: Canvas) {
        val s = min(width, height) - arc.strokeWidth
        box.set((width - s) / 2, (height - s) / 2, (width + s) / 2, (height + s) / 2)
        c.drawOval(box, track)
        val sweep = 40 + 220 * (0.5f - 0.5f * cos(t * 2 * Math.PI).toFloat())
        c.drawArc(box, t * 720f, sweep, false, arc)
    }
}

/** Three-segment progress (Front · Back · Chip). */
class StepBar @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val d = resources.displayMetrics.density
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    var steps = 3
    var current = 0
        set(v) { field = v; invalidate() }
    var onDark = true
        set(v) { field = v; invalidate() }

    override fun onDraw(c: Canvas) {
        val gap = 6 * d
        val w = (width - gap * (steps - 1)) / steps
        val h = 4 * d
        val y = (height - h) / 2
        for (i in 0 until steps) {
            p.color = when {
                i <= current -> if (onDark) Color.WHITE else Color.parseColor("#111112")
                else -> if (onDark) Color.parseColor("#40FFFFFF") else Color.parseColor("#E2E2DD")
            }
            val x = i * (w + gap)
            c.drawRoundRect(x, y, x + w, y + h, h, h, p)
        }
    }
}

/**
 * Risk dial: a 240° arc split into low / medium / high bands, the score's arc drawn over it and
 * the number in the middle. Animates in.
 */
class RiskGauge @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val d = resources.displayMetrics.density
    private val band = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 10 * d; strokeCap = Paint.Cap.BUTT }
    private val value = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 10 * d; strokeCap = Paint.Cap.ROUND }
    private val knob = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val knobRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d }
    private val num = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); color = Color.parseColor("#111112")
    }
    private val cap = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        color = Color.parseColor("#9A9CA3"); letterSpacing = 0.14f
    }
    private val box = RectF()
    private var shown = 0f
    var score = 0
        private set
    private val start = 150f
    private val span = 240f

    val colorLow = Color.parseColor("#0B8A5B")
    val colorMid = Color.parseColor("#B86E00")
    val colorHigh = Color.parseColor("#D7261B")

    fun colorFor(s: Int) = when { s >= 60 -> colorHigh; s >= 25 -> colorMid; else -> colorLow }

    fun set(score: Int, animate: Boolean = true) {
        this.score = score
        if (!animate) { shown = score.toFloat(); invalidate(); return }
        ValueAnimator.ofFloat(0f, score.toFloat()).apply {
            duration = 1100; interpolator = DecelerateInterpolator(2f); startDelay = 150
            addUpdateListener { shown = it.animatedValue as Float; invalidate() }
        }.start()
    }

    override fun onDraw(c: Canvas) {
        val s = min(width.toFloat(), height * 1.25f) - band.strokeWidth - 8 * d
        val cx = width / 2f
        val cy = band.strokeWidth / 2 + 4 * d + s / 2
        box.set(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2)
        // bands: 0–25 low, 25–60 medium, 60–100 high
        val g = 1.2f
        fun seg(a: Float, b: Float, col: Int) {
            band.color = Color.argb(46, Color.red(col), Color.green(col), Color.blue(col))
            c.drawArc(box, start + span * a / 100 + g, span * (b - a) / 100 - 2 * g, false, band)
        }
        seg(0f, 25f, colorLow); seg(25f, 60f, colorMid); seg(60f, 100f, colorHigh)
        val col = colorFor(shown.toInt())
        value.color = col
        if (shown > 0.5f) c.drawArc(box, start, span * shown / 100, false, value)
        val a = Math.toRadians((start + span * shown / 100).toDouble())
        val kx = cx + (s / 2) * cos(a).toFloat(); val ky = cy + (s / 2) * sin(a).toFloat()
        knobRing.color = col
        c.drawCircle(kx, ky, 8 * d, knob); c.drawCircle(kx, ky, 8 * d, knobRing)

        num.textSize = s * 0.30f
        c.drawText("${shown.toInt()}", cx, cy + num.textSize * 0.30f, num)
        cap.textSize = 11 * resources.displayMetrics.scaledDensity
        c.drawText("RISK SCORE", cx, cy + num.textSize * 0.30f + 22 * d, cap)
    }
}

/** NFC prompt: a card resting on a phone, with waves radiating from the chip. */
class NfcPulseView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {
    private val d = resources.displayMetrics.density
    private val phone = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f * d; color = Color.parseColor("#111112") }
    private val phoneFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F3F3F0") }
    private val card = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#111112") }
    private val chip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E0B85A") }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#55FFFFFF"); strokeWidth = 2.5f * d; strokeCap = Paint.Cap.ROUND }
    private val wave = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f * d; strokeCap = Paint.Cap.ROUND }
    private val r = RectF()
    private var t = 0f
    var active = false
        set(v) { field = v; wave.color = if (v) Color.parseColor("#0B8A5B") else Color.parseColor("#D7261B"); invalidate() }
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1600; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
        addUpdateListener { t = it.animatedValue as Float; invalidate() }
    }

    init { active = false }
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (isVisible) { if (!anim.isStarted) anim.start() } else anim.cancel()
    }
    override fun onDetachedFromWindow() { anim.cancel(); super.onDetachedFromWindow() }

    override fun onDraw(c: Canvas) {
        val h = height.toFloat(); val w = width.toFloat()
        val ph = h * 0.86f; val pw = ph * 0.5f
        val px = w / 2 - pw * 0.85f; val py = (h - ph) / 2
        r.set(px, py, px + pw, py + ph)
        c.drawRoundRect(r, 18 * d, 18 * d, phoneFill)
        c.drawRoundRect(r, 18 * d, 18 * d, phone)
        // card overlapping the upper part of the phone, slightly rotated
        val cw = pw * 1.25f; val ch = cw / 1.586f
        val ccx = px + pw * 0.95f; val ccy = py + ph * 0.34f
        c.save()
        c.rotate(-12f, ccx, ccy)
        r.set(ccx - cw / 2, ccy - ch / 2, ccx + cw / 2, ccy + ch / 2)
        c.drawRoundRect(r, 8 * d, 8 * d, card)
        val chx = r.left + cw * 0.14f; val chy = r.top + ch * 0.32f
        c.drawRoundRect(chx, chy, chx + cw * 0.17f, chy + ch * 0.28f, 3 * d, 3 * d, chip)
        c.drawLine(r.left + cw * 0.45f, r.top + ch * 0.38f, r.right - cw * 0.12f, r.top + ch * 0.38f, line)
        c.drawLine(r.left + cw * 0.45f, r.top + ch * 0.56f, r.right - cw * 0.25f, r.top + ch * 0.56f, line)
        c.restore()
        // waves
        val ox = ccx + cw * 0.05f; val oy = ccy - ch * 0.55f
        for (i in 0 until 3) {
            val p = (t + i / 3f) % 1f
            val rad = 14 * d + p * 44 * d
            wave.alpha = (255 * (1 - p)).toInt()
            r.set(ox - rad, oy - rad, ox + rad, oy + rad)
            c.drawArc(r, 215f, 110f, false, wave)
        }
    }
}
