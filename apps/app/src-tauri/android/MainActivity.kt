// Replaces the MainActivity.kt that `tauri android init` generates (the build copies it in; the package line is
// taken from the generated file). The app draws edge to edge, under the status and navigation bars; this tells
// the page how big those bars are (CSS --sa-t/r/b/l, in CSS pixels) so it can keep its controls clear of them,
// and lets the page pick light or dark bar icons to match its own theme.
package app.moshion.desktop

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var insetsJson = "{\"t\":0,\"r\":0,\"b\":0,\"l\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // read the bars' sizes whenever the layout changes (rotation, the navigation bar shown or hidden); this only
    // reads them, so it never takes the insets away from anything else that handles them
    val root = findViewById<View>(android.R.id.content)
    root.viewTreeObserver.addOnGlobalLayoutListener { readInsets(root) }
  }

  override fun onResume() {
    super.onResume()
    webView?.let { push(it) }
  }

  private fun readInsets(view: View) {
    val wi = ViewCompat.getRootWindowInsets(view) ?: return
    val b = wi.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val d = resources.displayMetrics.density
    val json = "{\"t\":${b.top / d},\"r\":${b.right / d},\"b\":${b.bottom / d},\"l\":${b.left / d}}"
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
