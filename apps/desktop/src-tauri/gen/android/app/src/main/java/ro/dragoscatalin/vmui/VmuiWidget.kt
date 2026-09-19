package ro.dragoscatalin.vmui

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.util.concurrent.Executors

/**
 * Home-screen widget: inside temperature, lights on/total, water today, with a
 * "+250 ml" button and a tap-to-open. Data comes from /api/display/state via
 * the paired device token. Android refreshes it every 30 min
 * (updatePeriodMillis); ACTION_REFRESH re-pulls after our own writes.
 */
class VmuiWidget : AppWidgetProvider() {
  companion object {
    const val ACTION_WATER = "ro.dragoscatalin.vmui.WIDGET_WATER"
    const val ACTION_REFRESH = "ro.dragoscatalin.vmui.WIDGET_REFRESH"
    private val io = Executors.newSingleThreadExecutor()

    fun refreshAll(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = mgr.getAppWidgetIds(ComponentName(ctx, VmuiWidget::class.java))
      if (ids.isNotEmpty()) render(ctx, mgr, ids)
    }

    private fun render(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
      io.execute {
        val st = Vmui.get(ctx, "/api/display/state")
        val temp = st?.optJSONObject("inside")?.optJSONObject("temp")?.optString("state")
        val home = st?.optJSONObject("home")
        val lightsOn = home?.optInt("lightsOn", -1) ?: -1
        val lightsTotal = home?.optInt("lightsTotal", 0) ?: 0
        val water = st?.optJSONObject("nutrition")?.optJSONObject("water")
        val ml = water?.optInt("ml", -1) ?: -1
        val target = water?.optInt("targetMl", 0) ?: 0
        for (id in ids) {
          val v = RemoteViews(ctx.packageName, R.layout.widget_vmui)
          v.setTextViewText(R.id.w_temp, if (temp.isNullOrEmpty()) "—" else "$temp°")
          v.setTextViewText(R.id.w_lights, if (lightsOn < 0) "—" else "$lightsOn/$lightsTotal")
          v.setTextViewText(R.id.w_water, if (ml < 0) "—" else "${ml / 1000.0}".take(4).trimEnd('0').trimEnd('.') + " l" + (if (target > 0) " / ${target / 1000.0}".take(6).trimEnd('0').trimEnd('.') else ""))
          v.setTextViewText(R.id.w_status, if (st == null) (if (Vmui.conn(ctx) == null) "neconfigurat" else "offline") else "dormitor")
          val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
          val waterI = Intent(ctx, VmuiWidget::class.java).setAction(ACTION_WATER)
          v.setOnClickPendingIntent(R.id.w_water_btn, PendingIntent.getBroadcast(ctx, 1, waterI, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
          mgr.updateAppWidget(id, v)
        }
      }
    }
  }

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    render(context, appWidgetManager, appWidgetIds)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_WATER -> Vmui.control(context, Vmui.actionBody("water")!!) { refreshAll(context) }
      ACTION_REFRESH -> refreshAll(context)
    }
  }
}
