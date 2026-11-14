/**
 * The messages of Prospection, as they ship: Réglages → Prospection lets an
 * admin change each one, and these are what a setting reads as until then.
 *
 * Placeholders, filled by `fillTemplate` (model.ts):
 *   {name}      the owner's name as the post shows it (may be empty)
 *   {property}  one line naming the property (« دار 180 م² · صفاقس »)
 *   {deal}      « للبيع » or « للكراء » (« à vendre » / « à louer »), so the owner can correct it
 *   {terms}     the link to the terms of use
 *   {link}      the link to the owner's annonce, once it is online (in the agency message: the agencies' page)
 *   {manage}    the owner's private link to take it down or mark it sold
 *   {phone}     the number of the team, for any question
 *
 * The first message carries everything the owner's « yes » stands for: the
 * publication, who they are to the property (the owner or their representative:
 * they say it in their answer, instead of signing a statement), the terms, and
 * the photos of their post. It is what the team pastes back as proof, so it
 * must say all of that in words the owner reads. The brand is written in Latin
 * letters too: « مازد » dictated by voice came out as « مزاد » (an auction).
 *
 * The Arabic one is the owner's own wording (2026-11-14): it hands the owner
 * the sentence to answer with. Where the example named one land (« سي عماد »,
 * « الأرض الفلاحية المشجّرة في بولذياب », « البيعة »), the holes and words that
 * fit every annonce stand instead: a poster may be a woman, a page, a rental.
 */

export const ASK_AR =
  "عسلامة {name}، معاك فريق مازد إيمو (Mazed Immo) 🏡\n\n" +
  "شفنا إعلانك {deal} ({property})، وحبّينا نقترحوا عليك ننشروه زادة على منصّتنا العقارية ببلاش، باش يوصل لناس أكثر تلوّج على عقار كيفو.\n\n" +
  "إذا تحبّ، بعد ما تطّلع على شروط النشر ({terms})، يكفي تجاوبنا هكّا:\n\n" +
  "«نعم، أنا [المالك / الوكيل]، موافق على شروط النشر ونسمحلكم تستعملوا تصاور البوست في الإعلان على مازد إيمو.»\n\n" +
  "وإذا ما يناسبكش، يكفي تقولنا «لا» وما نعاودوش نتصلوا بيك على الإعلان هذا.\n\n" +
  "يعيشك {name}، وبالتوفيق!";

export const ASK_FR =
  "Bonjour {name}, souhaitez-vous que nous publiions votre annonce {deal} ({property}) gratuitement sur Mazed Immo ? Si oui, répondez « oui » en nous disant si vous êtes le propriétaire ou son mandataire, acceptez les conditions d'utilisation ({terms}) et autorisez-nous à utiliser les photos de votre publication. Sinon, répondez « non » et nous ne vous écrirons plus.";

// An agency is not an owner: nothing is published for it, it is invited to open an agence of its own.
// The offer's numbers are not written here: the page the link opens shows them, with the places left.
export const ASK_AGENCY_AR =
  "سلام {name}، شفنا إعلاناتكم في فيسبوك. مازد إيمو (Mazed Immo) موقع إعلانات عقارية في تونس، وعندنا عرض للوكالات اللي تبدا معانا: تشوفو العرض والبلايص المتبقية هنا: {link}. تنجمو تنشرو إعلاناتكم عندنا وتستوردوها من Excel، وأحسن إعلاناتكم نبرزوها في صفحتنا في فيسبوك. تحبو نبعثولكم التفاصيل؟";

export const ASK_AGENCY_FR =
  "Bonjour {name}, nous avons vu vos annonces sur Facebook. Mazed Immo est un site d'annonces immobilières en Tunisie, et nous avons une offre pour les agences qui démarrent avec nous : vous la découvrez, avec les places restantes, ici : {link}. Vous publiez vos annonces chez nous, vous les importez depuis Excel, et vos meilleures annonces sont relayées sur notre page Facebook. Souhaitez-vous que nous vous envoyions les détails ?";

// An SMS in Arabic letters costs three segments or so; the details are on the page the link opens.
export const SMS_AR =
  "إعلانك تنشر في مازد إيمو: {link}\nباش تحذفو ولا تعلّمو «تباع»: {manage}\nأي سؤال: {phone}";

export const SMS_FR =
  "Votre annonce est en ligne sur Mazed Immo : {link}\nPour la retirer ou la marquer vendue : {manage}\nUne question : {phone}";
