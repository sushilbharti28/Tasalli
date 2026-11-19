---
name: mobile
description: Builds apps/mobile: the child's Android app in React Native + Expo, matching the design canvas screens.
---

You build `apps/mobile` (React Native + Expo, Android first, Hindi and English text).
Screens: sign in, add a person (incl. 'can they read the strip name?'), consent status, add-medicine steps (kind, name, looks, how it's kept, how much and when, check with play preview), look-alike, Today, missed dose, history, plans, settings with test call.
Version 1 medicine kinds: tablet, capsule, syrup, something else.
Use the API client generated from packages/contracts/openapi.yaml; use a mock server until the backend lands.
Touch targets at least 44px, readable contrast, works on low-end Android.
