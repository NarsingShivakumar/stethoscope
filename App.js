import React, { useEffect, useRef, useState } from 'react';
import { Alert, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Splash from './src/Splash';
import AiStethHomeScreen from './src/aiStethApp/screens/AiStethHomeScreen';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecordingsListSection } from './src/aiStethApp/components/sections/RecordingsListSection';

// Ignore all log notifications
LogBox.ignoreAllLogs(true);
const Stack = createNativeStackNavigator();

function App() {
  const navigationContainerRef = useRef();

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
      <NavigationContainer ref={navigationContainerRef}>
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Splash" component={Splash} />
          <Stack.Screen name="AiStethHomeScreen" component={AiStethHomeScreen} />
          <Stack.Screen name="RecordingsListSection" component={RecordingsListSection} /> 

        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

export default App;