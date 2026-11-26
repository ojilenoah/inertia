// Replaces the MainActivity.kt that `tauri android init` generates (the build copies it in; the package line is
// taken from the generated file). The app draws edge to edge, under the status and navigation bars; this tells
// the page how big those bars are (CSS --sa-t/r/b/l, in CSS pixels) so it can keep its controls clear of them,
// and lets the page pick light or dark bar icons to match its own theme.
package app.moshion.desktop

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var insetsJson = "{\"t\":0,\"r\":0,\"b\":0,\"l\":0}"
  private var fullHeight: Boolean? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // turns all four ways, upside down included (still follows the phone's rotation lock)
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    // read the bars' sizes whenever the layout changes (rotation, the navigation bar shown or hidden); this only
    // reads them, so it never takes the insets away from anything else that handles them
    val root = findViewById<View>(android.R.id.content)
    root.viewTreeObserver.addOnGlobalLayoutListener { readInsets(root) }
  }

  override fun onResume() {
    super.onResume()
    fullHeight = null // coming back: hide the bars again if the phone is on its side
    findViewById<View>(android.R.id.content)?.let { fitBars(it) }
    webView?.let { push(it) }
  }

  // a phone on its side (either way round): no status or navigation bar, so the app gets the whole height; a swipe
  // in from the edge shows them for a moment. Upright: the bars stay, and the page keeps clear of them.
  private fun fitBars(view: View) {
    val d = resources.displayMetrics.density
    val w = view.width / d
    val h = view.height / d
    if (w <= 0f || h <= 0f) return
    val sideways = w > h && minOf(w, h) < 600f
    if (sideways == fullHeight) return
    fullHeight = sideways
    val c = WindowCompat.getInsetsController(window, window.decorView)
    if (sideways) {
      c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      c.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      c.show(WindowInsetsCompat.Type.systemBars())
    }
  }

  private fun readInsets(view: View) {
    fitBars(view)
    val wi = ViewCompat.getRootWindowInsets(view) ?: return
    val b = wi.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val d = resources.displayMetrics.density
    // the view's own size too: the page's interface-size setting lays itself out from it
    val json = "{\"t\":${b.top / d},\"r\":${b.right / d},\"b\":${b.bottom / d},\"l\":${b.left / d}," +
      "\"w\":${view.width / d},\"h\":${view.height / d}}"
    if (json == insetsJson) return
    insetsJson = json
    webView?.let { push(it) }
  }

  // the page defines window.__inertiaInsets once it has started; before that it asks InertiaBars.insets() itself
  private fun push(w: WebView) {
    val js = "window.__inertiaInsets && window.__inertiaInsets($insetsJson)"
    w.post { w.evaluateJavascript(js, null) }
  }

  @SuppressLint("JavascriptInterface", "AddJavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    // honour the page's own viewport width: the interface-size setting draws everything smaller by laying the page
    // out wider and fitting it to the screen (like a lower display size); without this the page spills off the side
    webView.settings.useWideViewPort = true
    webView.settings.loadWithOverviewMode = false
    webView.addJavascriptInterface(Bars(), "InertiaBars")
    readInsets(findViewById(android.R.id.content))
    // in case the page started before the first reading
    for (ms in longArrayOf(400, 1500, 4000)) webView.postDelayed({ push(webView) }, ms)
  }

  inner class Bars {
    @JavascriptInterface
    fun insets(): String = insetsJson

    @JavascriptInterface
    fun setDark(dark: Boolean) {
      runOnUiThread {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = !dark
        c.isAppearanceLightNavigationBars = !dark
      }
    }
  }
}
