package ch.attest.onboarding.core

import android.content.Context

/** The last session this phone delivered, so it can pick up a re-verification requested later. */
object LastSession {
    private const val PREFS = "attest_last"

    fun save(ctx: Context, session: String, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("session", session).putString("token", token).apply()
    }

    fun get(ctx: Context): Pair<String, String>? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val s = p.getString("session", null) ?: return null
        val t = p.getString("token", null) ?: return null
        return s to t
    }
}
