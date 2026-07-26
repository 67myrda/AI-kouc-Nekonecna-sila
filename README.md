# AI kouč – Nekonečná síla

Osobní appka na procvičování technik z knihy Nekonečná síla (Anthony Robbins)
formou nepravidelných denních lekcí s AI koučem.

**Fáze 1**: kostra appky, navigace mezi sekcemi, statický obsah.
**Fáze 2a** (tato verze): přihlašovací brána přes Google, uzavřený seznam
povolených e-mailů. Databáze (ukládání cílů/hodnot/pokroku) přijde ve Fázi 2b,
živý AI kouč ve Fázi 3.

## Soubory appky

- `index.html` — struktura appky + přihlašovací brána
- `style.css` — veškeré styly
- `app.js` — navigace mezi sekcemi
- `firebase-init.js` — přihlášení přes Google, kontrola seznamu povolených e-mailů

## Nutné nastavení ve Firebase (jednorázově)

1. Authentication → Sign-in method → povolit Google
2. Authentication → Settings → Authorized domains → přidat `67myrda.github.io`

## Jak appku nasadit na GitHub Pages

1. Na github.com/67myrda vytvoř nový repozitář, např. `ai-kouc-nekonecna-sila`
   (Public, bez README — to už máš tady).
2. Nahraj do něj tři soubory z téhle složky: `index.html`, `style.css`, `app.js`
   (přes "Add file → Upload files" v repu).
3. V repu jdi do **Settings → Pages**, jako Source vyber `main` branch, složku `/root`.
4. Za chvíli poběží appka na `https://67myrda.github.io/ai-kouc-nekonecna-sila/`.
5. Otevři tuhle adresu na tabletu i na mobilu a mrkni, jak appka reaguje na obě
   velikosti obrazovky (na tabletu postranní menu vlevo, na mobilu spodní lišta).

## Co v této fázi ještě nefunguje (záměrně)

- Tlačítka a čísla na "Dnes" jsou zástupná (statická ukázková data)
- AI kouč je jen maketa rozhraní, chat nikam neodesílá
- Přepínače v Připomínkách si nic nepamatují po obnovení stránky
- Cíle, Hodnoty a Deník zatím nic neukládají

Tohle vše přichází ve Fázi 2 (Firestore) a Fázi 3 (živý AI kouč).

## Zpětná vazba k designu / rozvržení

Než půjdeme dál, stálo by za to ověřit hlavně:
- čitelnost textu na displeji tabletu/mobilu
- jestli spodní navigace na mobilu nezakrývá obsah
- jestli "jiskrový kruh" na Dnes vypadá tak, jak sis představoval
