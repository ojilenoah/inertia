// Replaces the MainActivity.kt that `tauri android init` generates (the build copies it in; the package line is
// taken from the generated file). The app draws edge to edge, under the status and navigation bars; this tells
// the page how big those bars are (CSS --sa-t/r/b/l, in CSS pixels) so it can keep its controls clear of them,
// and lets the page pick light or dark bar icons to match its own theme. It also gives the page a folder of the
// person's choosing (Android's own folder picker, kept across restarts) to save exported videos into.
package app.moshion.desktop

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var insetsJson = "{\"t\":0,\"r\":0,\"b\":0,\"l\":0}"
  private var fullHeight: Boolean? = null
  private lateinit var pickFolderLauncher: ActivityResultLauncher<Uri?>
  private val outs = ConcurrentHashMap<String, Pair<Uri, OutputStream>>()
  private val nextOut = AtomicInteger(0)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // turns all four ways, upside down included (still follows the phone's rotation lock)
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    // the export folder: Android's own folder picker (what it grants is kept across restarts)
    pickFolderLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> folderPicked(uri) }
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
    webView.addJavascriptInterface(Files(), "InertiaFiles")
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

  /* ---------------- the export folder ---------------- */
  private fun prefs() = getSharedPreferences("inertia", MODE_PRIVATE)
  private fun treeUri(): Uri? = prefs().getString("exportTree", null)?.let { Uri.parse(it) }

  /** A folder's name as people know it ("Movies/Inertia"), from Android's tree id ("primary:Movies/Inertia"). */
  private fun folderName(tree: Uri): String {
    return try {
      val id = DocumentsContract.getTreeDocumentId(tree)
      val path = id.substringAfter(':', id)
      if (path.isEmpty()) "Phone storage" else path
    } catch (e: Exception) {
      ""
    }
  }

  private fun folderPicked(uri: Uri?) {
    var name = ""
    if (uri != null) {
      try {
        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      } catch (e: Exception) {
      }
      prefs().edit().putString("exportTree", uri.toString()).apply()
      name = folderName(uri)
    }
    val js = "window.__inertiaFolder && window.__inertiaFolder(" + JSONObject.quote(name) + ")"
    webView?.let { w -> w.post { w.evaluateJavascript(js, null) } }
  }

  /** For the page: the chosen folder, choosing one, and writing a file into it in pieces (base64). */
  inner class Files {
    @JavascriptInterface
    fun folder(): String {
      val t = treeUri() ?: return ""
      // still allowed? (it can be taken back in the phone's settings)
      val ok = contentResolver.persistedUriPermissions.any { it.uri == t && it.isWritePermission }
      return if (ok) folderName(t) else ""
    }

    @JavascriptInterface
    fun pickFolder() {
      runOnUiThread { pickFolderLauncher.launch(null) }
    }

    @JavascriptInterface
    fun begin(name: String, mime: String): String {
      val t = treeUri() ?: return ""
      return try {
        val parent = DocumentsContract.buildDocumentUriUsingTree(t, DocumentsContract.getTreeDocumentId(t))
        val doc = DocumentsContract.createDocument(contentResolver, parent, mime, name) ?: return ""
        val out = contentResolver.openOutputStream(doc) ?: return ""
        val id = nextOut.incrementAndGet().toString()
        outs[id] = Pair(doc, out)
        id
      } catch (e: Exception) {
        ""
      }
    }

    @JavascriptInterface
    fun write(id: String, b64: String): Boolean {
      val o = outs[id] ?: return false
      return try {
        o.second.write(Base64.decode(b64, Base64.NO_WRAP))
        true
      } catch (e: Exception) {
        false
      }
    }

    @JavascriptInterface
    fun finish(id: String): String {
      val o = outs.remove(id) ?: return ""
      return try {
        o.second.flush()
        o.second.close()
        o.first.toString()
      } catch (e: Exception) {
        ""
      }
    }

    /** Open a saved file in the phone's own app for it (the gallery, a video player). */
    @JavascriptInterface
    fun open(uri: String, mime: String) {
      runOnUiThread {
        try {
          val i = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          startActivity(Intent.createChooser(i, null))
        } catch (e: Exception) {
        }
      }
    }

    /** Share a saved file (messages, social apps…). */
    @JavascriptInterface
    fun share(uri: String, mime: String) {
      runOnUiThread {
        try {
          val i = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, Uri.parse(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          startActivity(Intent.createChooser(i, null))
        } catch (e: Exception) {
        }
      }
    }
  }
}
