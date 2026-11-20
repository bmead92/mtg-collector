package dev.mtgcollection.downloads

import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Files in the shared Downloads folder (they survive uninstalling the app). Without storage permissions an
// app only sees the files it created itself, and only since it was installed.
class DownloadsStoreModule : Module() {
  private val resolver
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).contentResolver

  private val collection: Uri
    get() = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

  private fun relativePath(folder: String) = "${Environment.DIRECTORY_DOWNLOADS}/$folder/"

  // A name taken by a file from an earlier install gets " (1)" etc. appended, so match on the stem.
  private fun findOwn(folder: String, name: String): Uri? {
    val stem = name.substringBeforeLast('.')
    resolver.query(
      collection,
      arrayOf(MediaStore.Downloads._ID, MediaStore.Downloads.DISPLAY_NAME),
      "${MediaStore.Downloads.RELATIVE_PATH} = ? AND ${MediaStore.Downloads.DISPLAY_NAME} LIKE ?",
      arrayOf(relativePath(folder), "$stem%"),
      "${MediaStore.Downloads.DATE_MODIFIED} DESC",
    )?.use { c ->
      while (c.moveToNext()) {
        val found = c.getString(1)
        if (found == name || Regex(Regex.escape(stem) + """ \(\d+\)\.json""").matches(found)) {
          return ContentUris.withAppendedId(collection, c.getLong(0))
        }
      }
    }
    return null
  }

  override fun definition() = ModuleDefinition {
    Name("DownloadsStore")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    AsyncFunction("save") { sourcePath: String, name: String, folder: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw Exception("Needs Android 10")
      val source = File(Uri.parse(sourcePath).path ?: sourcePath)
      if (!source.exists() || source.length() == 0L) throw Exception("Nothing to save")
      val existing = findOwn(folder, name)
      val uri = existing ?: resolver.insert(
        collection,
        ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, name)
          put(MediaStore.Downloads.MIME_TYPE, "application/json")
          put(MediaStore.Downloads.RELATIVE_PATH, relativePath(folder))
          put(MediaStore.Downloads.IS_PENDING, 1)
        },
      ) ?: throw Exception("Could not create $name")
      resolver.openOutputStream(uri, "wt")!!.use { out -> source.inputStream().use { it.copyTo(out) } }
      if (existing == null) resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      uri.toString()
    }

    AsyncFunction("list") { folder: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction emptyList<Map<String, Any>>()
      val out = mutableListOf<Map<String, Any>>()
      resolver.query(
        collection,
        arrayOf(MediaStore.Downloads._ID, MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.DATE_MODIFIED),
        "${MediaStore.Downloads.RELATIVE_PATH} = ?",
        arrayOf(relativePath(folder)),
        null,
      )?.use { c ->
        while (c.moveToNext()) {
          out.add(mapOf("id" to c.getLong(0).toString(), "name" to c.getString(1), "modified" to c.getLong(2) * 1000))
        }
      }
      out
    }

    AsyncFunction("remove") { id: String ->
      resolver.delete(ContentUris.withAppendedId(collection, id.toLong()), null, null)
      Unit
    }
  }
}
