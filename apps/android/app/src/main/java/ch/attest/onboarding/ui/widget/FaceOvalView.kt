package ch.attest.onboarding.ui.widget

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator

/** Selfie overlay: dims everything outside a face oval; the ring shows state and step progress. */
class FaceOvalView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {

    enum class State(val color: Int) {
        SEARCHING(Color.WHITE), GUIDING(Color.parseColor("#FFC24B")), READY(Color.parseColor("#2BD48A")),
        CAPTURING(Color.parseColor("#2BD48A")), DONE(Color.parseColor("#2BD48A")),
    }

    private val d = resources.displayMetrics.density
    val oval = RectF()
    private val scrim = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E00B0B0C") }
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4 * d; color = Color.parseColor("#33FFFFFF") }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 5 * d; strokeCap = Paint.Cap.ROUND }
    private val path = Path()
    private var shown = 0f

    var state = State.SEARCHING
        set(v) { field = v; invalidate() }

    /** 0..1: fills the ring clockwise (capture or gesture progress) */
    var progress = 0f
        set(v) {
            field = v.coerceIn(0f, 1f)
            ValueAnimator.ofFloat(shown, field).apply {
                duration = 250; interpolator = DecelerateInterpolator()
                addUpdateListener { shown = it.animatedValue as Float; invalidate() }
            }.start()
        }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val ow = w * 0.68f
        val oh = ow * 1.32f
        val cy = h * 0.40f
        oval.set((w - ow) / 2, cy - oh / 2, (w + ow) / 2, cy + oh / 2)
    }

    override fun onDraw(c: Canvas) {
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        path.addOval(oval, Path.Direction.CW)
        c.drawPath(path, scrim)
        c.drawOval(oval, track)
        ring.color = state.color
        if (shown > 0f) c.drawArc(oval, -90f, 360f * shown, false, ring)
        else if (state != State.SEARCHING) c.drawOval(oval, ring.apply { alpha = 150 }).also { ring.alpha = 255 }
    }
}
