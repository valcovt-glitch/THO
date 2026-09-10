# Truck Hours Offline 🚛

Mobilná Expo/React Native aplikácia na orientačné sledovanie jazdy, práce, pohotovosti a odpočinku.

## Offline architektúra

- Nepoužíva vzdialené API ani cloudovú databázu.
- Všetky aktivity, zmeny, nastavenia a história sa ukladajú priamo v telefóne cez AsyncStorage.
- Výpočty prestávok a limitov prebiehajú priamo v aplikácii.
- Online analytika a Expo aktualizácie sú vypnuté.
- Android konfigurácia blokuje oprávnenie `INTERNET`.
- GPS a lokálne upozornenia fungujú aj bez mobilných dát a Wi-Fi.

> Odinštalovaním aplikácie sa lokálne údaje vymažú. Pri ukončení dňa je možné uložiť alebo zdieľať textový súhrn zmeny.

## APK bez počítača cez GitHub Actions

Projekt obsahuje workflow `.github/workflows/build-apk.yml`.

1. Nahraj obsah projektu do súkromného GitHub repozitára.
2. Otvor kartu **Actions**.
3. Vyber **Build offline Android APK**.
4. Stlač **Run workflow**.
5. Po dokončení otvor výsledný beh a stiahni artefakt **TruckHoursOffline-APK**.
6. Rozbaľ ZIP v telefóne a nainštaluj `TruckHoursOffline.apk`.

Pri prvom spustení Android požiada o polohu, polohu na pozadí a oznámenia.

## Lokálne spustenie pre vývoj

```bash
npm install
npx expo start
```

## Kontrola výpočtov

```bash
npm run test:rules
```

Aplikácia je orientačná pomôcka a nenahrádza certifikovaný tachograf ani právne posúdenie pracovného času.
