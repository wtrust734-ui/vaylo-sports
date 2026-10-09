# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ============================================================================
# VAYLO RELEASE RULES (R8 is enabled in app/build.gradle)
# ----------------------------------------------------------------------------
# Capacitor's stock template ships R8 disabled, so these rules never ran. With
# shrinking on, the bridge reaches classes by reflection/by name at runtime and
# R8 cannot see those references from Java alone — the keeps below preserve
# exactly those surfaces and nothing more.
# ============================================================================

# Capacitor resolves @CapacitorPlugin/@PluginMethod-annotated members of every
# registered plugin (including our custom VayloHealthConnect) reflectively.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-dontwarn com.getcapacitor.**

# The bridge creates plugin instances reflectively and holds them by their
# androidx.ActivityResult API surfaces.
-keep class com.getcapacitor.** { *; }

# Health Connect's client is reached through its contract/result API; the
# record classes are constructed by the library itself.
-keep class androidx.health.connect.client.** { *; }
-dontwarn androidx.health.connect.client.**

# Coroutines on the plugin's IO scope — keep the debug metadata intact so
# suspend stack traces stay readable in a crash report.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# Google Play services loader (brought in via the Health Connect SDK path).
-dontwarn com.google.android.gms.**
