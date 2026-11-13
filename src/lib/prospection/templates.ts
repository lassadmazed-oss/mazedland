/**
 * The messages of Prospection, as they ship: Réglages → Prospection lets an
 * admin change each one, and these are what a setting reads as until then.
 *
 * Placeholders, filled by `fillTemplate` (model.ts):
 *   {name}      the owner's name as the post shows it (may be empty)
 *   {property}  one line naming the property (« دار 180 م² · صفاقس »)
 *   {deal}      « للبيع » or « للكراء » (« à vendre » / « à louer »), so the owner can correct it
 *   {terms}     the link to the terms of use
 *   {link}      the link to the owner's annonce, once it is online
 *   {manage}    the owner's private link to take it down or mark it sold
 *   {phone}     the number of the team, for any question
 *
 * The first message carries everything the owner's « yes » stands for: the
 * publication, who they are to the property (the owner or their representative:
 * they say it in their answer, instead of signing a statement), the terms, and
 * the photos of their post. It is what the team pastes back as proof, so it
 * must say all of that in words the owner reads. The brand is written in Latin
 * letters too: « مازد » dictated by voice came out as « مزاد » (an auction).
 */

export const ASK_AR =
  "سلام {name}، كان تحب ننشرو إعلانك {deal} ({property}) في مازد إيمو (Mazed Immo) ببلاش؟ كان موافق ردّ بـ«نعم» وقلّنا إنت المالك متاعو ولا الوكيل، وتقبل الشروط ({terms})، وتسمحلنا نستعملو صور بوستك. وكان ما تحبش ردّ بـ«لا» وما نعاودوش.";

export const ASK_FR =
  "Bonjour {name}, souhaitez-vous que nous publiions votre annonce {deal} ({property}) gratuitement sur Mazed Immo ? Si oui, répondez « oui » en nous disant si vous êtes le propriétaire ou son mandataire, acceptez les conditions d'utilisation ({terms}) et autorisez-nous à utiliser les photos de votre publication. Sinon, répondez « non » et nous ne vous écrirons plus.";

// An SMS in Arabic letters costs three segments or so; the details are on the page the link opens.
export const SMS_AR =
  "إعلانك تنشر في مازد إيمو: {link}\nباش تحذفو ولا تعلّمو «تباع»: {manage}\nأي سؤال: {phone}";

export const SMS_FR =
  "Votre annonce est en ligne sur Mazed Immo : {link}\nPour la retirer ou la marquer vendue : {manage}\nUne question : {phone}";
