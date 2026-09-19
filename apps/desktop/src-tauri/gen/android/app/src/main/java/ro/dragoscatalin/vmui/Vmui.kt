package ro.dragoscatalin.vmui

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Native-side client for the bits that run without the webview: launcher
 * shortcuts and the home-screen widget. Reads the same conn.json the Rust
 * side writes after pairing (app data dir / conn.json = {url, token}).
 */
object Vmui {
  private val io = Executors.newSingleThreadExecutor()

  data class Conn(val url: String, val token: String)

  fun conn(ctx: Context): Conn? {
    // tauri's app_data_dir() on Android resolves to Context.getDataDir() (tauri/src/path/android.rs)
    val f = File(ctx.dataDir, "conn.json")
    if (!f.exists()) return null
    return try {
      val j = JSONObject(f.readText())
      val u = j.optString("url"); val t = j.optString("token")
      if (u.isEmpty() || t.isEmpty()) null else Conn(u, t)
    } catch (_: Exception) { null }
  }

  /** POST /api/display/control with the device bearer token. Result on a background thread. */
  fun control(ctx: Context, body: JSONObject, done: ((Boolean) -> Unit)? = null) {
    post(ctx, "/api/display/control", body) { ok, _ -> done?.invoke(ok) }
  }

  /** POST any vmui JSON endpoint with the device bearer token; parsed JSON body (or null) on a background thread. */
  fun post(ctx: Context, path: String, body: JSONObject, done: ((Boolean, JSONObject?) -> Unit)? = null) {
    val c = conn(ctx) ?: run { done?.invoke(false, null); return }
    io.execute {
      var res: JSONObject? = null
      val ok = try {
        val con = (URL(c.url + path).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"; connectTimeout = 6000; readTimeout = 8000; doOutput = true
          setRequestProperty("content-type", "application/json")
          setRequestProperty("authorization", "Bearer " + c.token)
        }
        con.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = con.responseCode
        val stream = if (code in 200..299) con.inputStream else con.errorStream
        res = try { stream?.bufferedReader()?.readText()?.let { JSONObject(it) } } catch (_: Exception) { null }
        if (code !in 200..299) android.util.Log.w("vmui", "POST $path -> $code ${res}")
        code in 200..299
      } catch (e: Exception) { android.util.Log.w("vmui", "POST $path failed: $e"); false }
      done?.invoke(ok, res)
    }
  }

  /** PUT /api/notify/token — FCM registration, re-sent whenever it rotates. */
  fun registerPush(ctx: Context, token: String?) {
    val c = conn(ctx) ?: return
    io.execute {
      try {
        val con = (URL(c.url + "/api/notify/token").openConnection() as HttpURLConnection).apply {
          requestMethod = "PUT"; connectTimeout = 6000; readTimeout = 8000; doOutput = true
          setRequestProperty("content-type", "application/json")
          setRequestProperty("authorization", "Bearer " + c.token)
        }
        con.outputStream.use { it.write(JSONObject().put("token", token ?: JSONObject.NULL).toString().toByteArray()) }
        con.responseCode
      } catch (_: Exception) { -1 }
    }
  }

  fun get(ctx: Context, path: String): JSONObject? {
    val c = conn(ctx) ?: return null
    return try {
      val con = (URL(c.url + path).openConnection() as HttpURLConnection).apply {
        connectTimeout = 6000; readTimeout = 8000
        setRequestProperty("authorization", "Bearer " + c.token)
      }
      if (con.responseCode !in 200..299) null else JSONObject(con.inputStream.bufferedReader().readText())
    } catch (_: Exception) { null }
  }

  /** Shortcut / widget actions → control bodies. Fixed vocabulary, nothing arbitrary. */
  fun actionBody(act: String): JSONObject? = when (act) {
    "movie" -> JSONObject().put("type", "ambilight").put("mode", "movie")
    "music" -> JSONObject().put("type", "ambilight").put("mode", "music")
    "off" -> JSONObject().put("type", "ambilight").put("mode", "off")
    "water" -> JSONObject().put("type", "water").put("ml", 250)
    "pc_wake" -> JSONObject().put("type", "script").put("name", "pc_wake")
    else -> null
  }
}
