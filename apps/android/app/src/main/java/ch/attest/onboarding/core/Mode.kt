package ch.attest.onboarding.core

import android.content.Context
import ch.attest.onboarding.BuildConfig

/**
 * VERBOSE (presenter) — every signal, score and reason on screen, live during capture; for pitches,
 *                       review and debugging. Only in builds with ALLOW_PRESENTER (debug).
 * PRODUCTION          — applicants see capture guidance only: no signal chips, no colour-coded
 *                       states, no attack results, a neutral ending. The same signals are computed
 *                       and sealed to the backend, never shown: telling an attacker which check caught
 *                       them turns the app into an oracle they can iterate against.
 */
object Mode {
    private const val PREFS = "attest"
    private const val KEY = "stage"

    /** whether this build can show the verbose view at all (never in release) */
    val available: Boolean get() = BuildConfig.ALLOW_PRESENTER

    @Volatile private var verbose: Boolean = BuildConfig.DEFAULT_STAGE

    /** verbose presenter view active */
    val stage: Boolean get() = available && verbose

    private val listeners = mutableSetOf<(Boolean) -> Unit>()

    fun load(ctx: Context) {
        verbose = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, BuildConfig.DEFAULT_STAGE)
    }

    fun set(ctx: Context, on: Boolean) {
        if (!available) return
        verbose = on
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
        listeners.toList().forEach { it(stage) }
    }

    fun toggle(ctx: Context): Boolean { set(ctx, !verbose); return stage }

    /** screens that render differently per mode subscribe while visible */
    fun observe(l: (Boolean) -> Unit) { listeners += l }
    fun forget(l: (Boolean) -> Unit) { listeners -= l }
}
