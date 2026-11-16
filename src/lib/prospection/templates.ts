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

// After a yes given BY PHONE (2026-11-16): the owner is called first, because a WhatsApp is read hours later.
// What is sent afterwards is not a question any more: it writes down what was agreed, with the terms, so the
// owner has it in writing and can still say no. Same holes as the first message.
export const CONFIRM_AR =
  "عسلامة {name}، معاك فريق مازد إيمو (Mazed Immo) 🏡\n\n" +
  "كيما اتفقنا في التليفون، باش ننشروا إعلانك {deal} ({property}) على مازد إيمو ببلاش، مع تصاور البوست متاعك.\n\n" +
  "باش يكون عندك الاتفاق مكتوب: بالنشر، إنت تؤكّد إنك المالك ولا الوكيل وتقبل شروط الاستعمال ({terms}).\n\n" +
  "كان فما معلومة غالطة، ولا ما عادش تحب ننشروه، جاوبنا «لا» وما ننشروش شي.\n\n" +
  "نبعثولك رابط إعلانك كيف يتنشر. يعيشك {name}!";

export const CONFIRM_FR =
  "Bonjour {name}, comme convenu au téléphone, nous publions votre annonce {deal} ({property}) gratuitement sur Mazed Immo, avec les photos de votre publication. Pour garder l'accord par écrit : en nous laissant publier, vous confirmez être le propriétaire ou son mandataire et vous acceptez les conditions d'utilisation ({terms}). Si une information est fausse, ou si vous ne souhaitez plus la publication, répondez « non » et nous ne publierons rien. Nous vous envoyons le lien de votre annonce dès qu'elle est en ligne.";

// An agency is not an owner: nothing is published for it, it is invited to open an agence of its own.
// The offer's numbers are not written here: the page the link opens shows them, with the places left.
// The Arabic one is the owner's wording too (2026-11-14), with the agency's name and the link as holes;
// « Mazed Immo Pro » names the site in Latin letters.
export const ASK_AGENCY_AR =
  "عسلامة {name}، معاكم فريق مازد إيمو 🏡\n\n" +
  "شفنا إعلانات وكالتكم على فيسبوك وحبّينا نعرّفوكم بـ Mazed Immo Pro، عرضنا للوكالات العقارية اللي تحب توسّع انتشار عروضها.\n\n" +
  "تنجموا تنشروا عقاراتكم على المنصّة وتستوردوا إعلاناتكم من ملف Excel دفعة وحدة. ونختاروا زادة من بين أحسن عروضكم باش نبرزوها على صفحة مازد إيمو في فيسبوك.\n\n" +
  "تنجموا تشوفوا عرض الانطلاق والبلايص المتبقّية هنا 👇\n{link}\n\n" +
  "تحبّوا نبعثولكم تفاصيل العرض ونوريولكم كيفاش تستوردوا إعلاناتكم؟";

export const ASK_AGENCY_FR =
  "Bonjour {name}, nous avons vu vos annonces sur Facebook. Mazed Immo est un site d'annonces immobilières en Tunisie, et nous avons une offre pour les agences qui démarrent avec nous : vous la découvrez, avec les places restantes, ici : {link}. Vous publiez vos annonces chez nous, vous les importez depuis Excel, et vos meilleures annonces sont relayées sur notre page Facebook. Souhaitez-vous que nous vous envoyions les détails ?";

// An SMS in Arabic letters costs three segments or so; the details are on the page the link opens.
export const SMS_AR =
  "إعلانك تنشر في مازد إيمو: {link}\nباش تحذفو ولا تعلّمو «تباع»: {manage}\nأي سؤال: {phone}";

export const SMS_FR =
  "Votre annonce est en ligne sur Mazed Immo : {link}\nPour la retirer ou la marquer vendue : {manage}\nUne question : {phone}";
