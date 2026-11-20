# Dodocam

Babyphone maison : un téléphone dans la chambre, un ou plusieurs téléphones parents. Le son et/ou l'image en direct, une alerte quand bébé pleure, bouge ou se réveille, pour la nuit comme pour la sieste. Sans compte et sans pub.

## [Ouvrir et installer Dodocam](https://bengameworkshop.github.io/dodocam/)

Ouvre ce lien sur tes téléphones (Chrome sur Android, Safari sur iPhone), puis touche **Installer** en haut de la page.

## Comment ça marche

- L'image et le son passent **directement** d'un téléphone à l'autre (WebRTC).
- Pour se retrouver, les téléphones s'échangent un court message de connexion via [ntfy.sh](https://ntfy.sh), un relais gratuit. Ce message est **chiffré** avec une clé créée par le téléphone bébé et partagée par QR code : le relais ne peut ni le lire ni le modifier.
- Sans internet, une connexion manuelle (deux QR codes) reste possible.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `index.html` | Les écrans |
| `css/style.css` | Le style |
| `js/util.js` | Outils communs (stockage, écrans, petites fenêtres) |
| `js/sounds.js` | Sonneries |
| `js/qr.js` | QR codes : affichage, scan, compression |
| `js/relay.js` | Mise en relation chiffrée via ntfy.sh |
| `js/rtc.js` | Connexion directe WebRTC |
| `js/baby.js` | Côté bébé : caméra, micro, détection des pleurs et du mouvement, batterie |
| `js/parent.js` | Côté parent : affichage, reconnexion, alertes, vérification |
| `js/app.js` | Accueil et installation |
| `sw.js` | Fonctionnement en appli installée |

Après une modification, change le numéro de version dans `sw.js` (`dodocam-v3` → `dodocam-v4`) pour que les téléphones prennent bien la nouvelle version.

---

Bibliothèques incluses : [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) et [jsQR](https://github.com/cozmo/jsQR) (Apache 2.0).
