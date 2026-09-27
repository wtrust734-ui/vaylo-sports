package com.vaylosports.app.health

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord

/**
 * The complete list of Health Connect permissions Vaylo Sports requests.
 *
 * Deliberately minimal — read access only, only data Vaylo Sports actually uses:
 * workouts, distance, active calories, heart rate, steps, sleep. New data
 * types are added by appending one entry here and bumping PERMISSIONS_VERSION;
 * the JS layer versions its stored consent against it so added permissions
 * surface as an explicit re-consent instead of a silent re-prompt.
 */
object HealthPermissions {

    /** Bump when the list below changes. */
    const val VERSION = 1

    val READ_PERMISSIONS: Set<String> = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
    )
}
