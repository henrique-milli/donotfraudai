package ch.attest.onboarding.ui

import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Edge-to-edge (enforced from targetSdk 35): windows draw under the status and navigation bars, and
 * each screen decides what must stay clear of them. Camera screens keep the preview full-bleed and
 * only inset their controls; light screens inset their content.
 */
private fun View.bars(i: WindowInsetsCompat) =
    i.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())

/** Adds the system-bar insets to this view's own padding. */
fun View.padForSystemBars(top: Boolean = true, bottom: Boolean = true) {
    val l = paddingLeft; val t = paddingTop; val r = paddingRight; val b = paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val s = v.bars(insets)
        v.setPadding(l + s.left, t + if (top) s.top else 0, r + s.right, b + if (bottom) s.bottom else 0)
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

/** Adds the system-bar insets to this view's margins (for controls floating over a full-bleed camera). */
fun View.marginForSystemBars(top: Boolean = false, bottom: Boolean = false) {
    val lp = layoutParams as? ViewGroup.MarginLayoutParams ?: return
    val mt = lp.topMargin; val mb = lp.bottomMargin; val ml = lp.leftMargin; val mr = lp.rightMargin
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val s = v.bars(insets)
        (v.layoutParams as ViewGroup.MarginLayoutParams).apply {
            topMargin = mt + if (top) s.top else 0
            bottomMargin = mb + if (bottom) s.bottom else 0
            leftMargin = ml + s.left; rightMargin = mr + s.right
        }
        v.requestLayout()
        insets
    }
    ViewCompat.requestApplyInsets(this)
}
