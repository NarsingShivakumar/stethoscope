package com.stethoscope;

import android.app.Activity;
import android.widget.Toast;

import androidx.annotation.NonNull;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class KioskModeModule extends ReactContextBaseJavaModule {
   private static ReactApplicationContext reactApplicationContext;

    public  KioskModeModule(ReactApplicationContext context){
      super(context);
       reactApplicationContext=context;
   }


    @NonNull
    @Override
    public String getName() {
        return "KioskMode";
    }

    @ReactMethod
    public void startKioskMode(){
        Activity activity=getCurrentActivity();

        activity.startLockTask();
        Toast.makeText(activity,"Kiosk mode enabled",Toast.LENGTH_SHORT).show();
    }

   @ReactMethod
   public void stopKioskMode(){
        Activity activity=getCurrentActivity();
        activity.stopLockTask();
        Toast.makeText(activity,"Kiosk Mode disabled",Toast.LENGTH_SHORT).show();
    }

     @ReactMethod
    public void isKioskModeEnabled(Callback callback) {
        Activity activity = getCurrentActivity();
        if (activity != null) {
            ActivityManager activityManager = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
            int lockTaskMode = activityManager.getLockTaskModeState();

            // Lock task states: LOCK_TASK_MODE_NONE, LOCK_TASK_MODE_LOCKED, or LOCK_TASK_MODE_PINNED
            boolean isKioskMode = (lockTaskMode == ActivityManager.LOCK_TASK_MODE_LOCKED ||
                    lockTaskMode == ActivityManager.LOCK_TASK_MODE_PINNED);

            callback.invoke(isKioskMode);
        }
    }
}
