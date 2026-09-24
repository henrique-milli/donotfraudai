package ch.attest.onboarding.ui.widget

import android.animation.AnimatorSet
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Camera
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator

/**
 * "Turn your card over": an ID-1 card drawn in 3D perspective that lifts, flips 180° around its
 * vertical axis from the front face (photo, text, chip) to the back face (the three MRZ lines),
 * and settles. Pure Canvas + android.graphics.Camera, so it is smooth on any device.
 */
class CardFlipView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {

    private val d = resources.displayMetrics.density
    private val cam = Camera()
    private val m = Matrix()
    private val card = RectF()
    private val body = Paint(Paint.ANTI_ALIAS_FLAG)
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2 * d; color = Color.parseColor("#66FFFFFF") }
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E6FFFFFF") }
    private val faint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#59FFFFFF") }
    private val chip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E0B85A") }
    private val accent = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#D7261B") }
    private val mrz = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#E6FFFFFF"); typeface = android.graphics.Typeface.MONOSPACE; letterSpacing = 0.05f
    }
    private val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#66000000") }

    private var angle = 0f      // 0 = front facing us, 180 = back facing us
    private var lift = 0f       // 0..1

    init { cam.setLocation(0f, 0f, -14f * d) }

    fun play(onDone: () -> Unit) {
        val up = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 280; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { lift = it.animatedValue as Float; invalidate() }
        }
        val flip = ValueAnimator.ofFloat(0f, 180f).apply {
            duration = 900; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { angle = it.animatedValue as Float; invalidate() }
        }
        val down = ValueAnimator.ofFloat(1f, 0f).apply {
            duration = 420; interpolator = OvershootInterpolator(1.4f)
            addUpdateListener { lift = it.animatedValue as Float; invalidate() }
        }
        AnimatorSet().apply {
            playSequentially(up, flip, down)
            startDelay = 250
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: android.animation.Animator) { postDelayed(onDone, 350) }
            })
            start()
        }
    }

    override fun onDraw(c: Canvas) {
        val w = minOf(width * 0.72f, height * 1.3f)
        val h = w / 1.586f
        val cx = width / 2f; val cy = height / 2f
        card.set(-w / 2, -h / 2, w / 2, h / 2)
        val scale = 1f + 0.08f * lift

        // soft shadow, shrinking while the card is lifted and edge-on
        val sw = w * (0.5f + 0.5f * kotlin.math.abs(kotlin.math.cos(Math.toRadians(angle.toDouble())).toFloat())) * (1f - 0.15f * lift)
        c.drawOval(cx - sw / 2, cy + h / 2 + 18 * d - 4 * d, cx + sw / 2, cy + h / 2 + 18 * d + 8 * d, shadow)

        c.save()
        cam.save()
        cam.rotateY(angle)
        cam.getMatrix(m)
        cam.restore()
        m.preScale(scale, scale)
        m.postTranslate(cx, cy - 16 * d * lift)
        c.concat(m)
        val back = angle > 90f
        if (back) c.scale(-1f, 1f) // mirror so the back face reads correctly
        val r = 12 * d
        body.color = if (back) Color.parseColor("#2A2D34") else Color.parseColor("#33363E")
        c.drawRoundRect(card, r, r, body)
        c.drawRoundRect(card, r, r, edge)
        if (back) drawBack(c, w, h) else drawFront(c, w, h)
        c.restore()
    }

    private fun drawFront(c: Canvas, w: Float, h: Float) {
        val l = -w / 2; val t = -h / 2
        c.drawRect(l, t + h * 0.08f, l + w, t + h * 0.2f, accent.apply { alpha = 200 })               // header band
        c.drawRoundRect(l + w * 0.06f, t + h * 0.3f, l + w * 0.32f, t + h * 0.9f, 6 * d, 6 * d, faint)  // photo
        c.drawCircle(l + w * 0.19f, t + h * 0.5f, w * 0.06f, ink.apply { alpha = 120 })                    // head
        c.drawRoundRect(l + w * 0.1f, t + h * 0.66f, l + w * 0.28f, t + h * 0.9f, 20 * d, 20 * d, ink.apply { alpha = 120 })
        ink.alpha = 230
        for (i in 0 until 4) {
            val y = t + h * (0.36f + i * 0.14f)
            c.drawRoundRect(l + w * 0.4f, y, l + w * (0.9f - i * 0.08f), y + h * 0.05f, 4 * d, 4 * d, if (i == 0) ink else faint)
        }
        c.drawRoundRect(l + w * 0.78f, t + h * 0.26f, l + w * 0.92f, t + h * 0.26f + h * 0.14f, 4 * d, 4 * d, chip)
    }

    private fun drawBack(c: Canvas, w: Float, h: Float) {
        val l = -w / 2; val t = -h / 2
        for (i in 0 until 3) {
            val y = t + h * (0.18f + i * 0.1f)
            c.drawRoundRect(l + w * 0.08f, y, l + w * (0.6f - i * 0.1f), y + h * 0.045f, 4 * d, 4 * d, faint)
        }
        // the machine-readable zone: what the back scan looks for
        c.drawRect(l, t + h * 0.58f, l + w, t + h * 0.94f, Paint().apply { color = Color.parseColor("#1AFFFFFF") })
        val lines = listOf("IDCHEA1B2C3D4<<<<<<<<<<<<<<<<", "9001014F3001012CHE<<<<<<<<<<<0", "MUSTER<<ANNA<<<<<<<<<<<<<<<<<")
        // 30 characters per line must fit the card with a margin
        mrz.textSize = 100f
        mrz.textSize = 100f * (w * 0.88f) / mrz.measureText(lines[1])
        lines.forEachIndexed { i, s -> c.drawText(s, l + w * 0.06f, t + h * (0.69f + i * 0.1f), mrz) }
    }
}
