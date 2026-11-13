/**
 * The messages of Prospection, as they ship: Réglages → Prospection lets an
 * admin change each one, and these are what a setting reads as until then.
 *
 * Placeholders, filled by `fillTemplate` (model.ts):
 *   {name}      the owner's name as the post shows it (may be empty)
 *   {property}  one line naming the property (« دار 180 م² · صفاقس »)
 *   {terms}     the link to the terms of use
 *   {link}      the link to the owner's annonce, once it is online
 *   {manage}    the owner's private link to take it down or mark it sold
 *   {phone}     the number of the team, for any question
 *
 * The first message carries everything the owner's « yes » stands for: the
 * publication, the attestation that they own the property or act for its
 * owner, the terms, and the photos of their post. It is what the team pastes
 * back as proof, so it must say all of that in words the owner reads.
 */

export const ASK_AR =
  "سلام {name}، نحبو ننشرو إعلانك ({property}) في مازد إيمو ببلاش، ونتكفّلو بكل شي. كان موافق ردّ بـ«نعم»: تشهد إنك المالك ولا الوكيل وإن المعلومات صحيحة، وتقبل الشروط ({terms})، وتسمحلنا نستعملو صور بوستك. وكان ما تحبش ردّ بـ«لا» وما نعاودوش.";

export const ASK_FR =
  "Bonjour {name}, nous aimerions publier votre annonce ({property}) gratuitement sur Mazed Immo, et nous nous occupons de tout. Si vous êtes d'accord, répondez « oui » : vous attestez être le propriétaire ou son mandataire et que les informations sont exactes, vous acceptez les conditions d'utilisation ({terms}) et vous nous autorisez à utiliser les photos de votre publication. Sinon répondez « non » et nous ne vous écrirons plus.";

// An SMS in Arabic letters costs three segments or so; the details are on the page the link opens.
export const SMS_AR =
  "إعلانك تنشر في مازد إيمو: {link}\nباش تحذفو ولا تعلّمو «تباع»: {manage}\nأي سؤال: {phone}";

export const SMS_FR =
  "Votre annonce est en ligne sur Mazed Immo : {link}\nPour la retirer ou la marquer vendue : {manage}\nUne question : {phone}";
