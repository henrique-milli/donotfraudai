package ch.attest.onboarding.signals

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Samples gyroscope and accelerometer while a side is being scanned. A hand holding a phone is
 * never perfectly still (physiological tremor, ~0.01–0.1 rad/s); a rig, a stand or an emulator is.
 */
class MotionProbe(ctx: Context) : SensorEventListener {
    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private var gSq = 0.0
    private var gN = 0
    private var aSum = 0.0
    private var aSq = 0.0
    private var aN = 0
    @Volatile var liveGyro = 0.0
        private set

    val available get() = gyro != null

    fun start() {
        gyro?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        accel?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() = sm.unregisterListener(this)

    @Synchronized
    override fun onSensorChanged(e: SensorEvent) {
        val (x, y, z) = Triple(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
        val m2 = x * x + y * y + z * z
        if (e.sensor.type == Sensor.TYPE_GYROSCOPE) {
            gSq += m2; gN++
            liveGyro = 0.85 * liveGyro + 0.15 * sqrt(m2)
        } else {
            val m = sqrt(m2)
            aSum += m; aSq += m * m; aN++
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    @Synchronized fun gyroRms(): Double = if (gN == 0) Double.NaN else sqrt(gSq / gN)
    @Synchronized fun accelStd(): Double = if (aN < 2) Double.NaN else sqrt((aSq / aN - (aSum / aN).let { it * it }).coerceAtLeast(0.0))
    @Synchronized fun samples(): Int = gN
}
