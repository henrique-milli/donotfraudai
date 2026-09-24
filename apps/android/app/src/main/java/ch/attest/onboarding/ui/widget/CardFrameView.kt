package ch.attest.onboarding.ui.widget

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.min

/**
 * Scan overlay: dims everything outside an ID-1 shaped window (85.6 × 54 mm) and draws
 * corner brackets whose colour carries the state. A light sweep runs while capturing.
 */
class CardFrameView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {

    enum class State(val color: Int) {
        SEARCHING(Color.WHITE),
        GUIDING(Color.parseColor("#FFC24B")),
        READY(Color.parseColor("#2BD48A")),
        CAPTURING(Color.WHITE),
        DONE(Color.parseColor("#2BD48A")),
    }

    private val d = resources.displayMetrics.density
    val window = RectF()
    private val scrim = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#B30B0B0C") }
    private val bracket = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 4f * d; strokeCap = Paint.Cap.ROUND
    }
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1f * d; color = Color.parseColor("#40FFFFFF") }
    private val sweep = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private val radius = 14f * d

    var state = State.SEARCHING
        set(value) {
            if (field == value) return
            field = value
            if (value == State.CAPTURING) sweeper.start() else sweeper.cancel()
            if (value == State.DONE) doneAnim.start()
            invalidate()
        }

    private var sweepT = 0f
    private val sweeper = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1100; repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE
        interpolator = LinearInterpolator()
        addUpdateListener { sweepT = it.animatedValue as Float; invalidate() }
    }
    private var doneT = 0f
    private val doneAnim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 450
        addUpdateListener { doneT = it.animatedValue as Float; invalidate() }
    }

    /** fraction of height where the window's centre sits */
    var centerY = 0.42f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val ww = min(w * 0.88f, h * 0.9f)
        val wh = ww / 1.586f
        val cx = w / 2f
        val cy = h * centerY
        window.set(cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2)
    }

    override fun onDetachedFromWindow() {
        sweeper.cancel(); doneAnim.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(c: Canvas) {
        // scrim with a rounded hole
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        path.addRoundRect(window, radius, radius, Path.Direction.CW)
        c.drawPath(path, scrim)
        c.drawRoundRect(window, radius, radius, edge)

        if (state == State.CAPTURING) {
            val y = window.top + window.height() * sweepT
            sweep.shader = LinearGradient(0f, y - 60 * d, 0f, y, Color.TRANSPARENT, Color.parseColor("#55FFFFFF"), Shader.TileMode.CLAMP)
            c.save()
            c.clipRect(window)
            c.drawRect(window.left, y - 60 * d, window.right, y, sweep)
            c.restore()
        }
        if (state == State.DONE) {
            fill.color = Color.argb((70 * (1 - doneT * 0.5f)).toInt(), 43, 212, 138)
            c.drawRoundRect(window, radius, radius, fill)
        }

        // corner brackets
        bracket.color = state.color
        val len = 34f * d
        val inset = -3f * d
        val l = window.left + inset; val t = window.top + inset; val r = window.right - inset; val b = window.bottom - inset
        val rr = radius + 2 * d
        fun corner(x: Float, y: Float, sx: Int, sy: Int) {
            path.reset()
            path.moveTo(x, y + sy * len)
            path.lineTo(x, y + sy * rr)
            path.quadTo(x, y, x + sx * rr, y)
            path.lineTo(x + sx * len, y)
            c.drawPath(path, bracket)
        }
        corner(l, t, 1, 1); corner(r, t, -1, 1); corner(l, b, 1, -1); corner(r, b, -1, -1)
    }
}
