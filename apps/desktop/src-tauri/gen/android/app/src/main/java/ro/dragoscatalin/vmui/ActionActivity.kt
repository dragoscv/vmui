package ro.dragoscatalin.vmui

import android.app.Activity
import android.os.Bundle
import android.widget.Toast

/** Launcher shortcuts (long-press the icon) land here: run one fixed action, toast, finish. No UI. */
class ActionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val act = intent?.getStringExtra("vmui_action") ?: ""
    val body = Vmui.actionBody(act)
    if (body == null || Vmui.conn(this) == null) {
      Toast.makeText(this, "vmui: neconfigurat", Toast.LENGTH_SHORT).show()
      finish(); return
    }
    val label = mapOf("movie" to "Mod film", "music" to "Mod muzică", "off" to "Lumini stinse", "water" to "Apă +250 ml", "pc_wake" to "PC pornit")[act] ?: act
    Vmui.control(this, body) { ok ->
      runOnUiThread {
        Toast.makeText(this, if (ok) label else "vmui: nu a mers ($label)", Toast.LENGTH_SHORT).show()
        if (ok) VmuiWidget.refreshAll(this)
        finish()
      }
    }
  }
}
