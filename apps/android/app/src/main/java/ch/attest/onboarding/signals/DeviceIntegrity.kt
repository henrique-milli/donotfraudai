package ch.attest.onboarding.signals

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Debug
import android.provider.Settings
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Outcome
import java.io.File

/**
 * Is the capture channel trustworthy? Camera-injection attacks (virtual cameras, hooked camera
 * HALs, emulators fed with deepfaked or stolen images) bypass every image model, because the
 * pixels are "perfect". These cheap on-device checks catch the common tooling; a server-side
 * attestation (Play Integrity) would be the production complement.
 */
object DeviceIntegrity {

    fun collect(ctx: Context): List<Check> {
        val g = Group.DEVICE
        val out = ArrayList<Check>()

        val emu = emulatorHints()
        out += Check(
            g, null, "Physical device",
            if (emu.isEmpty()) Outcome.PASS else Outcome.FAIL,
            if (emu.isEmpty()) "${Build.MANUFACTURER} ${Build.MODEL}" else "emulator: " + emu.joinToString(),
            "no emulator fingerprint", risk = 60,
            why = "Running on an emulator, so the camera feed can be any file",
        )

        val hooks = hookingFrameworks()
        out += Check(
            g, null, "Hooking framework",
            if (hooks.isEmpty()) Outcome.PASS else Outcome.FAIL,
            if (hooks.isEmpty()) "none in process" else "DETECTED · " + hooks.joinToString(),
            "Frida / Xposed / Substrate absent", risk = 60,
            why = "A hooking framework is loaded, which is how camera feeds are replaced",
        )

        val root = rootHints(ctx)
        out += Check(
            g, null, "Root access",
            if (root.isEmpty()) Outcome.PASS else Outcome.WARN,
            if (root.isEmpty()) "not detected by software checks (see Verified boot)" else "ROOTED · " + root.joinToString(),
            "no su / root-manager app / Magisk mounts / test-keys", risk = 20,
            why = "The device is rooted, so the camera stack can be replaced",
        )

        val external = externalCameras(ctx)
        out += Check(
            g, null, "External camera",
            if (external == 0) Outcome.PASS else Outcome.WARN,
            if (external == 0) "none attached" else "ATTACHED · $external external camera(s)",
            "no USB / external camera", risk = 15,
            why = "An external camera is attached, a route for injecting a prepared video",
        )

        val debugger = Debug.isDebuggerConnected()
        out += Check(
            g, null, "Debugger",
            if (debugger) Outcome.WARN else Outcome.PASS,
            if (debugger) "ATTACHED" else "none", "Debug.isDebuggerConnected", risk = 5,
            why = "A debugger is attached to the app",
        )

        val adb = Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
        val dev = Settings.Global.getInt(ctx.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
        out += Check(g, null, "Developer settings", Outcome.INFO,
            "developer options ${onOff(dev)} · USB debugging ${onOff(adb)}", "recorded, common on genuine phones")

        val displays = (ctx.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).displays.size
        out += Check(g, null, "Displays", Outcome.INFO,
            if (displays > 1) "$displays (screen is mirrored or cast)" else "1", "recorded")

        @Suppress("DEPRECATION")
        val installer = runCatching {
            if (Build.VERSION.SDK_INT >= 30) ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
            else ctx.packageManager.getInstallerPackageName(ctx.packageName)
        }.getOrNull()
        out += Check(g, null, "Install source", Outcome.INFO, installer ?: "sideloaded", "recorded")
        return out
    }

    private fun onOff(b: Boolean) = if (b) "on" else "off"

    private fun emulatorHints(): List<String> = buildList {
        val fp = Build.FINGERPRINT.lowercase()
        if (fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("emulator")) add("fingerprint")
        val hw = Build.HARDWARE.lowercase()
        if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox")) add("hardware ${Build.HARDWARE}")
        val model = Build.MODEL.lowercase()
        if (model.contains("emulator") || model.contains("android sdk built for") || model.contains("sdk_gphone")) add("model")
        val product = Build.PRODUCT.lowercase()
        if (product.startsWith("sdk") || product.contains("emulator") || product.contains("vbox") || product.contains("genymotion")) add("product")
        if (Build.MANUFACTURER.contains("Genymotion", true)) add("Genymotion")
    }

    /** root-manager apps survive renaming ("Hide the Magisk app"): their launcher label and components give them away */
    private val ROOT_LABELS = listOf("magisk", "kernelsu", "apatch", "supersu", "superuser", "lsposed")
    private val ROOT_COMPONENTS = listOf("com.topjohnwu.", "me.weishu.kernelsu", "me.bmax.apatch", "eu.chainfire.supersu", "org.lsposed.")

    /** Launcher apps whose label or component names belong to a root manager, whatever their package name. */
    fun rootManagerApps(ctx: Context): List<String> = runCatching {
        val pm = ctx.packageManager
        val launcher = android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(launcher, 0).mapNotNull { ri ->
            val label = ri.loadLabel(pm).toString()
            val comp = ri.activityInfo.name
            val byLabel = ROOT_LABELS.any { label.lowercase().replace(" ", "").contains(it) }
            val byComp = ROOT_COMPONENTS.any { comp.startsWith(it) }
            if (byLabel || byComp) "$label (${ri.activityInfo.packageName}${if (byComp) "" else ", renamed"})" else null
        }.distinct()
    }.getOrDefault(emptyList())

    private fun rootHints(ctx: Context): List<String> = buildList {
        // classic locations + where modern Magisk / KernelSU put su, + every directory on PATH
        val dirs = listOf("/system/bin", "/system/xbin", "/sbin", "/su/bin", "/data/local/xbin", "/data/local/bin",
            "/system_ext/bin", "/product/bin", "/vendor/bin", "/debug_ramdisk", "/system/sbin", "/cache", "/data/local") +
            (System.getenv("PATH")?.split(':').orEmpty())
        val suFound = dirs.distinct().map { "$it/su" }.filter { File(it).exists() }
        if (suFound.isNotEmpty()) add("su at ${suFound.first()}")
        if (File("/debug_ramdisk/magisk").exists() || File("/system/bin/magisk").exists()) add("magisk binary")
        rootManagerApps(ctx).takeIf { it.isNotEmpty() }?.let { add("root manager app: ${it.joinToString()}") }
        val mounts = runCatching { File("/proc/self/mountinfo").readText() }.getOrDefault("")
        if (mounts.contains("magisk") || mounts.contains("/debug_ramdisk") || mounts.contains("KSU")) add("Magisk mounts in process")
        if (Build.TAGS?.contains("test-keys") == true) add("test-keys build")
        if (File("/sbin/.magisk").exists() || File("/data/adb/magisk").exists()) add("Magisk")
    }

    private fun hookingFrameworks(): List<String> = buildList {
        val maps = runCatching { File("/proc/self/maps").readText().lowercase() }.getOrDefault("")
        if (maps.contains("frida") || maps.contains("gum-js-loop") || maps.contains("gadget")) add("Frida")
        if (maps.contains("xposed") || maps.contains("lspd") || maps.contains("edxp")) add("Xposed/LSPosed")
        if (maps.contains("substrate")) add("Substrate")
        if (runCatching { Class.forName("de.robv.android.xposed.XposedBridge") }.isSuccess) add("XposedBridge class")
    }.distinct()

    private fun externalCameras(ctx: Context): Int = runCatching {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        cm.cameraIdList.count { id ->
            cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_EXTERNAL
        }
    }.getOrDefault(0)
}
