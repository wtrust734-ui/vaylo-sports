package com.vaylosports.app.camera

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Native camera capture for Vaylo.
 *
 * Why this exists instead of `@capacitor/camera`: that plugin's Android source
 * needs the Kotlin 2.2 compiler, and this project pins
 * `kotlin-gradle-plugin:1.9.24` in android/build.gradle for its existing Kotlin
 * sources, so it does not compile here. That was verified, not assumed —
 * `:capacitor-camera:compileDebugKotlin` fails with
 * `Cannot access 'CAMERA': it is private in 'Companion'` at CameraPlugin.kt:31.
 * Roughly a hundred lines against the platform APIs removes the dependency and
 * the version skew with it.
 *
 * Both paths are permission-free by design:
 *   - capture: `ACTION_IMAGE_CAPTURE` delegates to the system camera app. The
 *     photo is written into our own cache and handed back through the
 *     FileProvider already declared in AndroidManifest.xml, so the app holds no
 *     storage permission and never sees the camera app's storage.
 *   - pick: `ACTION_PICK_IMAGES` on API 33+ is Android's system photo picker,
 *     which runs out-of-process and returns a grant-scoped URI — hence no
 *     READ_MEDIA_IMAGES anywhere. `ACTION_OPEN_DOCUMENT` on API 30-32 is the
 *     Storage Access Framework, also permission-free.
 *
 * Uses Capacitor's `startActivityForResult` / `@ActivityCallback` flow, the
 * same mechanism HealthConnectPlugin already uses, rather than the androidx
 * activity-result launchers — those need a ComponentActivity-typed handle that
 * `Plugin.activity` is not.
 *
 * Both methods resolve with `{ dataUrl }`, a base64 data URL of exactly the
 * shape ai-analyze expects in `image_base64`. A cancelled capture resolves
 * `{ cancelled: true }` rather than rejecting: backing out of a camera is not
 * something the athlete did wrong.
 */
@CapacitorPlugin(name = "VayloCamera")
class CameraCapturePlugin : Plugin() {

    /** Where the in-flight camera URI lives between launch and result. */
    private var captureUri: Uri? = null

    /**
     * The file behind `captureUri`.
     *
     * Kept alongside the URI so cleanup never has to go through the provider —
     * see deleteCaptureFile.
     */
    private var captureFile: File? = null

    /** Take a new photo with the device camera. */
    @PluginMethod
    fun capture(call: PluginCall) {
        val activity = this.activity
        if (activity == null) {
            call.reject("No activity available")
            return
        }

        val target = try {
            newCaptureFile(activity)
        } catch (e: Exception) {
            call.reject("Couldn't prepare the camera: ${e.message}", e)
            return
        }
        val uri = FileProvider.getUriForFile(
            activity,
            activity.packageName + ".fileprovider",
            target
        )

        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        // Without EXTRA_OUTPUT the camera app returns a 160x160 thumbnail,
        // which is useless for analysing a running form.
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
        // Declared in the manifest <queries> block; without it
        // resolveActivity returns null on API 30+ even when a camera app is
        // installed, because Android hides undeclared packages.
        if (intent.resolveActivity(activity.packageManager) == null) {
            // No camera on this device. Report it as a cancel so the caller
            // falls back to the picker rather than showing an error.
            deleteCaptureFile(target)
            call.resolve(cancelled())
            return
        }

        captureUri = uri
        captureFile = target
        startActivityForResult(call, intent, "onCaptureResult")
    }

    /** Choose an existing photo from the system photo picker. */
    @PluginMethod
    fun pick(call: PluginCall) {
        val intent = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "image/*"
                // One image: the caller sends exactly one to the AI, and
                // multi-select would mean silently discarding the rest.
                putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 1)
            }
        } else {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
            }
        }
        startActivityForResult(call, intent, "onPickResult")
    }

    @ActivityCallback
    private fun onCaptureResult(call: PluginCall?, result: ActivityResult) {
        val uri = captureUri
        val file = captureFile
        captureUri = null
        captureFile = null
        if (call == null) {
            deleteCaptureFile(file)
            return
        }

        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            // RESULT_CANCELED — the athlete backed out of the camera.
            deleteCaptureFile(file)
            call.resolve(cancelled())
            return
        }
        try {
            val bytes = readDownscaled(uri, MAX_EDGE)
            call.resolve(payload(bytes, mimeFor(uri)))
        } catch (e: Throwable) {
            // Throwable, not Exception: decoding a full-size photo on a
            // low-memory device raises OutOfMemoryError, which is an Error, so it
            // escaped this handler and took the whole process down — losing
            // whatever the athlete had open. A rejected call is recoverable; a
            // crash is not.
            call.reject("Couldn't read the photo: ${e.message}", asException(e))
        } finally {
            // The temporary file has served its purpose either way.
            deleteCaptureFile(file)
        }
    }

    @ActivityCallback
    private fun onPickResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri: Uri? = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(cancelled())
            return
        }
        try {
            val bytes = readDownscaled(uri, MAX_EDGE)
            if (bytes == null) {
                call.resolve(cancelled())
                return
            }
            call.resolve(payload(bytes, mimeFor(uri)))
        } catch (e: Throwable) {
            // See onCaptureResult: on a big image this is an Error, not an
            // Exception, and a pick must not crash the app either.
            call.reject("Couldn't read the photo: ${e.message}", asException(e))
        }
    }

    /**
     * A Throwable that can be handed to `PluginCall.reject`.
     *
     * Both catches above are deliberately `Throwable`: decoding a full-size
     * photo on a low-memory device raises `OutOfMemoryError`, which is an Error
     * and not an Exception, and an uncaught one takes the whole process down.
     * But `PluginCall.reject` has no Throwable overload — it takes an
     * Exception, a String or a JSONObject — so passing the caught value straight
     * through does not compile, which is a build failure that only appears when
     * the Kotlin is actually compiled. Wrapping keeps the original as the cause,
     * so logcat still shows what really threw.
     */
    private fun asException(e: Throwable): Exception =
        if (e is Exception) e else Exception(e)

    /**
     * The temporary file the camera app writes into, inside our own cache
     * directory. Cache is right: these are throwaway full-size JPEGs the app
     * immediately base64s and never needs to keep, and Android is free to
     * reclaim the space.
     *
     * The File is kept as well as its URI, because deleting the capture used to
     * go through `ContentResolver.delete` on a FileProvider URI — which is a
     * no-op unless the provider implements delete, and the failure was swallowed
     * by `runCatching`. Full-size JPEGs could therefore sit in the cache for the
     * life of the install.
     */
    private fun newCaptureFile(activity: Activity): File {
        val dir = File(activity.cacheDir, "vaylo-capture")
        if (!dir.exists() && !dir.mkdirs()) {
            throw IllegalStateException("cache directory unavailable")
        }
        return File(dir, "capture-${System.currentTimeMillis()}.jpg")
    }

    /** Delete the capture file. We created it, so we can remove it directly. */
    private fun deleteCaptureFile(file: File?) {
        if (file == null) return
        runCatching { if (file.exists()) file.delete() }
    }

    private fun mimeFor(uri: Uri): String {
        val type = this.context?.contentResolver?.getType(uri)
        return if (type != null && type.startsWith("image/")) type else "image/jpeg"
    }

    /**
     * Read, downsize and EXIF-rotate the image, then JPEG-encode it.
     *
     * A modern phone camera produces 4000x3000 JPEGs of several megabytes;
     * base64ing one and POSTing it to an edge function is slow enough to read
     * as "the app is broken", and an AI form description gains nothing from 12
     * megapixels. 1600px on the long edge keeps a full-body frame legible while
     * cutting the payload by roughly 90%.
     */
    private fun readDownscaled(uri: Uri, maxEdge: Int): ByteArray? {
        val resolver = this.context?.contentResolver ?: return null

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        try {
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        } catch (e: Throwable) {
            // Throwable: a decode can raise OutOfMemoryError on a large image.
            return null
        }
        val longEdge = maxOf(bounds.outWidth, bounds.outHeight)
        if (longEdge <= 0) return null

        // inSampleSize must be a power of two, so halve until within 2x.
        var sample = 1
        while (longEdge / (sample * 2) >= maxEdge) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = try {
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        } catch (e: Throwable) {
            null
        } ?: return null

        val oriented = applyExifRotation(resolver, uri, decoded)
        val out = ByteArrayOutputStream()
        oriented.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        if (oriented !== decoded) decoded.recycle()
        oriented.recycle()
        return out.toByteArray()
    }

    /**
     * EXIF rotation. A portrait photo is stored landscape with an orientation
     * tag, so without this the AI analyses an athlete lying on their side — the
     * single most damaging silent failure in a form-analysis app.
     */
    private fun applyExifRotation(
        resolver: android.content.ContentResolver,
        uri: Uri,
        bitmap: Bitmap,
    ): Bitmap {
        val orientation = try {
            resolver.openInputStream(uri)?.use { stream ->
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )
            }
        } catch (e: Throwable) {
            // No EXIF, or unreadable — the normal case for a camera app that
            // already baked rotation into the pixels.
            return bitmap
        } ?: return bitmap

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            else -> return bitmap
        }
        return try {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Throwable) {
            bitmap
        }
    }

    private fun payload(bytes: ByteArray?, mime: String): JSObject {
        val ret = JSObject()
        if (bytes == null || bytes.isEmpty()) {
            ret.put("cancelled", true)
            return ret
        }
        ret.put("dataUrl", "data:$mime;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
        ret.put("mimeType", mime)
        ret.put("bytes", bytes.size)
        return ret
    }

    private fun cancelled(): JSObject {
        val ret = JSObject()
        ret.put("cancelled", true)
        return ret
    }

    companion object {
        /** Long edge of the image sent for analysis, in pixels. */
        private const val MAX_EDGE = 1600

        /** 88 rather than 95: after downscaling, the artefacts of a higher
         *  setting are invisible and the smaller payload is worth more. */
        private const val JPEG_QUALITY = 88
    }
}
