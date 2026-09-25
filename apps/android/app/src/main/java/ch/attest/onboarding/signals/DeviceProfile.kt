package ch.attest.onboarding.signals

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.display.DisplayManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.nfc.NfcAdapter
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.telephony.TelephonyManager
import ch.attest.onboarding.core.Check
import ch.attest.onboarding.core.Group
import ch.attest.onboarding.core.Outcome
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale
import java.util.TimeZone

/**
 * Raw device data points for the risk backend. Nothing here needs a runtime permission. Each point
 * is weak alone; the backend learns which combinations mark emulator farms, rooted rigs, remote-
 * controlled phones and repackaged apps. A few obvious ones are also scored on device.
 */
object DeviceProfile {

    /** package → category. Visible through the <queries> block in the manifest. */
    val RISK_APPS = mapOf(
        "com.topjohnwu.magisk" to "root manager",
        "io.github.huskydg.magisk" to "root manager",
        "io.github.vvb2060.magisk" to "root manager",
        "me.weishu.kernelsu" to "root manager",
        "eu.chainfire.supersu" to "root manager",
        "org.lsposed.manager" to "hooking framework",
        "de.robv.android.xposed.installer" to "hooking framework",
        "org.meowcat.edxposed.manager" to "hooking framework",
        "com.saurik.substrate" to "hooking framework",
        "com.anydesk.anydeskandroid" to "remote control",
        "com.teamviewer.quicksupport.market" to "remote control",
        "com.teamviewer.teamviewer.market.mobile" to "remote control",
        "com.rustdesk.rustdesk" to "remote control",
        "com.lbe.parallel.intl" to "app cloner",
        "com.excelliance.dualaid" to "app cloner",
        "com.vmos.pro" to "virtual OS",
        "tech.httptoolkit.android.v1" to "traffic interception",
        "com.guoshi.httpcanary" to "traffic interception",
        "app.greyshirts.sslcapture" to "traffic interception",
        "com.emanuelef.remote_capture" to "traffic interception",
        "pl.nextcamera" to "external camera",
    )

    class Profile(val json: JSONObject, val checks: List<Check>)

    fun collect(ctx: Context): Profile {
        val j = JSONObject()
        val g = Group.DEVICE
        val checks = ArrayList<Check>()

        // stable per device + app signing key, hashed: lets the backend spot one device enrolling many identities
        val androidId = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        j.put("deviceId", MessageDigest.getInstance("SHA-256").digest("attest|$androidId".toByteArray()).joinToString("") { "%02x".format(it) })

        j.put("build", JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER); put("brand", Build.BRAND); put("model", Build.MODEL)
            put("device", Build.DEVICE); put("product", Build.PRODUCT); put("hardware", Build.HARDWARE)
            put("board", Build.BOARD); put("bootloader", Build.BOOTLOADER); put("fingerprint", Build.FINGERPRINT)
            put("type", Build.TYPE); put("tags", Build.TAGS); put("sdk", Build.VERSION.SDK_INT)
            put("release", Build.VERSION.RELEASE); put("securityPatch", Build.VERSION.SECURITY_PATCH)
            put("abis", JSONArray(Build.SUPPORTED_ABIS.toList())); put("radio", Build.getRadioVersion() ?: JSONObject.NULL)
        })

        // --- app integrity
        val signer = appSigner(ctx)
        val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val pkgInfo = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        j.put("app", JSONObject().apply {
            put("package", ctx.packageName); put("version", pkgInfo.versionName)
            put("signerSha256", signer); put("debuggable", debuggable)
            put("firstInstall", pkgInfo.firstInstallTime); put("lastUpdate", pkgInfo.lastUpdateTime)
        })
        checks += Check(g, null, "App signature", Outcome.INFO, (signer?.take(16) ?: "unknown") + if (debuggable) " · debug build" else "",
            "backend compares to the release certificate (repackaging)")

        // --- security posture
        val keyguard = (ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
        val a11y = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?.split(':')?.filter { it.isNotBlank() }.orEmpty()
        val mockLocation = Settings.Secure.getString(ctx.contentResolver, "mock_location") == "1"
        j.put("security", JSONObject().apply {
            put("screenLock", keyguard); put("accessibilityServices", JSONArray(a11y))
            put("adb", Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1)
            put("developerOptions", Settings.Global.getInt(ctx.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1)
            put("mockLocationLegacy", mockLocation)
        })
        checks += Check(g, null, "Screen lock", if (keyguard) Outcome.PASS else Outcome.WARN,
            if (keyguard) "set" else "none", "device protected by PIN / biometrics", risk = 5,
            why = "The phone has no screen lock")
        val a11yNames = a11y.map { it.substringBefore('/').substringAfterLast('.') }
        checks += Check(g, null, "Accessibility services", if (a11y.isEmpty()) Outcome.PASS else Outcome.WARN,
            if (a11y.isEmpty()) "none" else a11yNames.joinToString(), "none enabled (remote-access malware uses them)", risk = 10,
            why = "An accessibility service can read and drive the screen (remote-access fraud)")

        // --- risky apps
        val found = RISK_APPS.filterKeys { installed(ctx, it) } +
            DeviceIntegrity.rootManagerApps(ctx).associateWith { "root manager (renamed)" }
        j.put("riskApps", JSONObject(found as Map<*, *>))
        checks += Check(g, null, "Risk apps installed", if (found.isEmpty()) Outcome.PASS else Outcome.WARN,
            if (found.isEmpty()) "none of ${RISK_APPS.size} known" else found.values.distinct().joinToString(),
            "root managers · hooking · remote control · cloners · interception · external camera", risk = 15,
            why = "Tools used to tamper with or remotely drive the phone are installed")

        // --- sensors: emulators and rigs lack most of them
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensors = sm.getSensorList(Sensor.TYPE_ALL)
        val has = { t: Int -> sm.getDefaultSensor(t) != null }
        j.put("sensors", JSONObject().apply {
            put("count", sensors.size)
            put("gyroscope", has(Sensor.TYPE_GYROSCOPE)); put("accelerometer", has(Sensor.TYPE_ACCELEROMETER))
            put("magnetometer", has(Sensor.TYPE_MAGNETIC_FIELD)); put("barometer", has(Sensor.TYPE_PRESSURE))
            put("proximity", has(Sensor.TYPE_PROXIMITY)); put("light", has(Sensor.TYPE_LIGHT))
            put("vendors", JSONArray(sensors.map { it.vendor }.distinct()))
        })
        val physicalSuite = has(Sensor.TYPE_GYROSCOPE) && has(Sensor.TYPE_MAGNETIC_FIELD) && has(Sensor.TYPE_ACCELEROMETER)
        checks += Check(g, null, "Sensor suite", if (physicalSuite) Outcome.PASS else Outcome.WARN,
            "${sensors.size} sensors" + if (physicalSuite) "" else " · gyro/magnetometer missing", "gyro + accel + magnetometer",
            risk = 10, why = "Motion sensors are missing, typical of emulators")

        // --- cameras
        val cams = JSONArray()
        runCatching {
            val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            cm.cameraIdList.forEach { id ->
                val ch = cm.getCameraCharacteristics(id)
                cams.put(JSONObject().apply {
                    put("id", id)
                    put("facing", when (ch.get(CameraCharacteristics.LENS_FACING)) {
                        CameraCharacteristics.LENS_FACING_BACK -> "back"; CameraCharacteristics.LENS_FACING_FRONT -> "front"; else -> "external"
                    })
                    put("hwLevel", when (ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) {
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "legacy"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "limited"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "full"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "level3"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "external"
                        else -> "unknown"
                    })
                })
            }
        }
        j.put("cameras", cams)

        // --- NFC
        val nfc = NfcAdapter.getDefaultAdapter(ctx)
        j.put("nfc", JSONObject().apply { put("present", nfc != null); put("enabled", nfc?.isEnabled == true) })

        // --- network
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = runCatching { cm.getNetworkCapabilities(cm.activeNetwork) }.getOrNull()
        val vpn = caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        val proxy = System.getProperty("http.proxyHost")?.takeIf { it.isNotBlank() }
        j.put("network", JSONObject().apply {
            put("wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
            put("cellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
            put("vpn", vpn); put("proxy", proxy ?: JSONObject.NULL)
            put("validated", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
        })
        checks += Check(g, null, "Network path", if (proxy != null) Outcome.WARN else Outcome.INFO,
            listOfNotNull(if (vpn) "VPN" else null, proxy?.let { "proxy $it" }).ifEmpty { listOf("direct") }.joinToString(" · "),
            "proxy = traffic interception setup", risk = 10, why = "Traffic goes through a proxy, a typical interception setup")

        // --- telephony (no permission needed for these)
        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        val simCountry = tm.simCountryIso.orEmpty(); val netCountry = tm.networkCountryIso.orEmpty()
        j.put("telephony", JSONObject().apply {
            put("simState", tm.simState); put("simCountry", simCountry); put("networkCountry", netCountry)
            put("operator", tm.networkOperatorName.orEmpty()); put("phoneType", tm.phoneType)
        })
        checks += Check(g, null, "SIM / region", Outcome.INFO,
            "SIM ${simCountry.ifEmpty { "none" }} · network ${netCountry.ifEmpty { "—" }} · tz ${TimeZone.getDefault().id}", "recorded")

        // --- environment
        val battery = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val dm = ctx.resources.displayMetrics
        j.put("environment", JSONObject().apply {
            put("uptimeMs", SystemClock.elapsedRealtime())
            put("timezone", TimeZone.getDefault().id); put("locale", Locale.getDefault().toLanguageTag())
            put("battery", battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1)
            put("plugged", battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0)
            put("screen", "${dm.widthPixels}x${dm.heightPixels}@${dm.densityDpi}")
            put("displays", (ctx.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).displays.size)
            put("fontScale", ctx.resources.configuration.fontScale)
        })
        return Profile(j, checks)
    }

    private fun installed(ctx: Context, pkg: String) = runCatching {
        @Suppress("DEPRECATION") ctx.packageManager.getPackageInfo(pkg, 0); true
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    private fun appSigner(ctx: Context): String? = runCatching {
        val sigs = if (Build.VERSION.SDK_INT >= 28) {
            ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
        } else {
            ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures
        }
        sigs?.firstOrNull()?.toByteArray()?.let { MessageDigest.getInstance("SHA-256").digest(it).joinToString("") { b -> "%02x".format(b) } }
    }.getOrNull()
}
