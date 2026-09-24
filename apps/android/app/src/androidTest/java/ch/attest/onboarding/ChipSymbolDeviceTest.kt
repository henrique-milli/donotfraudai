package ch.attest.onboarding

import androidx.test.ext.junit.runners.AndroidJUnit4
import ch.attest.onboarding.scan.ChipSymbol
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.opencv.imgcodecs.Imgcodecs
import java.io.File

/**
 * Runs the chip-symbol detector on real card captures pushed to the device (never committed):
 *   adb push front_*.jpg back_*.jpg /data/local/tmp/chipsym/
 * front_* must carry the symbol, back_* must not.
 */
@RunWith(AndroidJUnit4::class)
class ChipSymbolDeviceTest {
    @Test
    fun symbolOnFronts_notOnBacks() {
        val dir = File("/data/local/tmp/chipsym")
        val files = dir.listFiles { f -> f.name.endsWith(".jpg") }?.sortedBy { it.name }.orEmpty()
        assumeTrue("no captures in $dir", files.isNotEmpty())
        val lines = files.map { f ->
            val img = Imgcodecs.imread(f.absolutePath)
            val r = ChipSymbol.detect(img).also { img.release() }
            android.util.Log.i("ChipSymbolTest", "%-20s %.3f %s".format(f.name, r.confidence, r.box))
            Triple(f.name, r.confidence, r.found)
        }
        lines.filter { it.first.startsWith("front") }.forEach { assertTrue("${it.first} ${it.second}", it.third) }
        lines.filter { it.first.startsWith("back") }.forEach { assertTrue("${it.first} ${it.second}", !it.third) }
    }
}
