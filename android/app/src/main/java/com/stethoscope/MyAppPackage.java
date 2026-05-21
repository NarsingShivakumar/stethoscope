

package com.stethoscope;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import com.stethoscope.aistethapp.SeparationAudioPlayer;
import com.stethoscope.aistethapp.StethoscopeRecorderModule;
import com.stethoscope.aistethapp.AudioRoutingManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
public class MyAppPackage implements ReactPackage {
    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();

    }
    @Override
    public List<NativeModule> createNativeModules(

            ReactApplicationContext reactContext) {

        List<NativeModule> modules = new ArrayList<>();
        modules.add(new KioskModeModule (reactContext));
        //  AiSteth bridge
        modules.add(new StethoscopeRecorderModule(reactContext));
        modules.add(new AudioRoutingManager(reactContext));
        modules.add(new SeparationAudioPlayer(reactContext));


        return modules;

    }

}
 
