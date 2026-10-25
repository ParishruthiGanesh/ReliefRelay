/**
 * Everything the assistant says, in every language it says it in.
 *
 * No reply string lives in the conversation logic any more. That matters for
 * more than tidiness: the *structure* of every reply is decided by code that
 * is tested — which caveats apply, whether a submission has actually happened,
 * whether anyone is on the way — and only the wording is looked up here. A
 * translation can therefore change how something reads, but it cannot make the
 * assistant claim something that did not happen.
 *
 * `reviewed` records whether a native speaker has checked the wording. It is
 * false where it is false, and the interface says so, because a mistranslated
 * question in a relief app is a real harm rather than a cosmetic one.
 */

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'ta', 'te', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
/** Any BCP-47-ish tag. Unlisted ones are handled by the model when configured. */
export type LanguageTag = string;

export interface Catalogue {
  label: string;
  englishName: string;
  /** Has a native speaker checked this wording? */
  reviewed: boolean;
  reviewNote?: string;
  strings: Record<string, string>;
}

const EN: Record<string, string> = {
  'opening.request': 'Tell me what you need and where you are. Take your time.',
  'opening.facility':
    'Tell me what has changed at your facility. For example, how many spaces are left.',

  'q.intent': 'Are you asking for supplies, or offering to provide them?',
  'q.intent.need': 'I need supplies',
  'q.intent.offer': 'I can provide supplies',
  'q.resources':
    'What do you need most right now? You can say food, drinking water, hygiene kits, or shelter space.',
  'q.location':
    'Where are you? Say the name of the place, type it, use your current location, or tap the map.',
  'q.location_choice.two':
    'I found two places that could match. Which one are you at — {a}, or {b}?',
  'q.location_choice.many': 'I found a few places that could match. Which one are you at?',
  'q.group_scope.yesno': 'Is this request for the whole group of {n}?',
  'q.group_scope.number': 'How many people is this for? If you are not sure, say “I don’t know”.',
  'q.quantity_ambiguous':
    'For {resource}, how much do you need in {unit}? If you are not sure, say “I don’t know” and a coordinator will work it out.',

  'answer.dont_know': 'I don’t know',
  'answer.yes': 'Yes',
  'answer.no': 'No',

  'ack.recorded': 'I recorded {list}',
  'ack.for_people': 'for {n} people',
  'ack.updated_people': 'updated to {n} people',
  'ack.at_place': 'at {place}',

  'readback.request': 'Your request is for {items}{forWhom}{place}.',
  'readback.offer': 'You are offering {items}{place}.',
  'readback.for_people': ' for {n} {people}',
  'readback.at_place': ' at {place}',
  'readback.submit_question': 'Shall I submit it?',

  'caveat.quantities': 'Supply quantities still need coordinator confirmation.',
  'caveat.location': 'The exact place has not been confirmed, so a coordinator will check it.',
  'caveat.danger':
    'You reported immediate danger. Please contact emergency services by phone — this app cannot send rescuers and has not contacted anyone for you.',
  'caveat.skipped': 'Some questions were skipped; a coordinator will see what is missing.',

  'submitted.confirmation':
    'Your request has been submitted. Your reference is {reference}. A coordinator has not yet accepted it.',
  'offline.not_sent': 'Saved on this device — not yet sent.',

  'danger.headline': 'This sounds like an emergency',
  'danger.body':
    'You described {what}. Please contact emergency services now by phone if you can — they are the only people who can send a rescue team. ReliefRelay coordinates supplies and shelter; it cannot send rescuers and has not contacted anyone on your behalf. You can still record what you need here, and a coordinator will see that you reported immediate danger so they can escalate it to the responders they work with.',
  'danger.call': 'Call {number} — {label}.',
  'danger.still_need': 'When you can, I still need one thing: {question}',
  'danger.generic': 'immediate danger',

  'quantity.unknown': 'quantity not yet known ({unitLabel})',
  'quantity.about': 'about {amount} {unitLabel} (unconfirmed)',
  'quantity.exact': '{amount} {unitLabel}',

  'people.one': 'person',
  'people.many': 'people',

  'category.meal_packs': 'Meal packs',
  'category.drinking_water': 'Drinking water',
  'category.hygiene_kits': 'Hygiene kits',
  'category.shelter_spaces': 'Shelter spaces',

  'unitLabel.meal_packs': 'meal packs',
  'unitLabel.drinking_water': 'litres',
  'unitLabel.hygiene_kits': 'hygiene kits',
  'unitLabel.shelter_spaces': 'shelter spaces',
};

const HI: Record<string, string> = {
  'opening.request': 'बताइए आपको क्या चाहिए और आप कहाँ हैं। आराम से बताइए।',
  'opening.facility':
    'बताइए आपके केंद्र में क्या बदला है। जैसे कि कितनी जगहें बची हैं।',

  'q.intent': 'क्या आप सामान माँग रहे हैं, या देना चाहते हैं?',
  'q.intent.need': 'मुझे सामान चाहिए',
  'q.intent.offer': 'मैं सामान दे सकता/सकती हूँ',
  'q.resources':
    'अभी आपको सबसे ज़्यादा क्या चाहिए? आप कह सकते हैं — खाना, पीने का पानी, स्वच्छता किट, या रहने की जगह।',
  'q.location':
    'आप कहाँ हैं? जगह का नाम बोलिए, लिखिए, अपनी मौजूदा लोकेशन इस्तेमाल कीजिए, या नक़्शे पर छूइए।',
  'q.location_choice.two':
    'दो जगहें मिलीं जो मेल खा सकती हैं। आप किस जगह पर हैं — {a}, या {b}?',
  'q.location_choice.many': 'कुछ जगहें मिलीं जो मेल खा सकती हैं। आप किस जगह पर हैं?',
  'q.group_scope.yesno': 'क्या यह अनुरोध पूरे {n} लोगों के समूह के लिए है?',
  'q.group_scope.number': 'यह कितने लोगों के लिए है? पक्का पता न हो तो कहिए “मुझे नहीं पता”।',
  'q.quantity_ambiguous':
    '{resource} के लिए आपको कितने {unit} चाहिए? पक्का पता न हो तो कहिए “मुझे नहीं पता”, समन्वयक तय कर लेंगे।',

  'answer.dont_know': 'मुझे नहीं पता',
  'answer.yes': 'हाँ',
  'answer.no': 'नहीं',

  'ack.recorded': 'मैंने दर्ज किया: {list}',
  'ack.for_people': '{n} लोगों के लिए',
  'ack.updated_people': 'बदलकर {n} लोग',
  'ack.at_place': '{place} पर',

  'readback.request': 'आपका अनुरोध है: {items}{forWhom}{place}।',
  'readback.offer': 'आप दे रहे हैं: {items}{place}।',
  'readback.for_people': ', {n} {people} के लिए',
  'readback.at_place': ', {place} पर',
  'readback.submit_question': 'क्या मैं इसे भेज दूँ?',

  'caveat.quantities': 'सामान की मात्रा की पुष्टि समन्वयक को करनी होगी।',
  'caveat.location': 'जगह की पुष्टि अभी नहीं हुई है, समन्वयक इसे जाँचेंगे।',
  'caveat.danger':
    'आपने तुरंत ख़तरे की बात कही है। कृपया फ़ोन से आपातकालीन सेवाओं से संपर्क करें — यह ऐप बचाव दल नहीं भेज सकता और इसने आपकी ओर से किसी से संपर्क नहीं किया है।',
  'caveat.skipped': 'कुछ सवाल छोड़ दिए गए; समन्वयक देख लेंगे कि क्या छूटा है।',

  'submitted.confirmation':
    'आपका अनुरोध भेज दिया गया है। आपका संदर्भ नंबर {reference} है। किसी समन्वयक ने अभी तक इसे स्वीकार नहीं किया है।',
  'offline.not_sent': 'इस डिवाइस पर सहेजा गया — अभी भेजा नहीं गया।',

  'danger.headline': 'यह आपात स्थिति लगती है',
  'danger.body':
    'आपने {what} बताया है। अगर हो सके तो अभी फ़ोन से आपातकालीन सेवाओं से संपर्क करें — केवल वही बचाव दल भेज सकते हैं। ReliefRelay सामान और आश्रय का समन्वय करता है; यह बचाव दल नहीं भेज सकता और इसने आपकी ओर से किसी से संपर्क नहीं किया है। आप यहाँ अपनी ज़रूरत दर्ज कर सकते हैं, और समन्वयक देखेंगे कि आपने तुरंत ख़तरे की सूचना दी है ताकि वे इसे आगे बढ़ा सकें।',
  'danger.call': '{number} पर कॉल करें — {label}।',
  'danger.still_need': 'जब हो सके, मुझे एक बात और चाहिए: {question}',
  'danger.generic': 'तुरंत ख़तरा',

  'quantity.unknown': 'मात्रा अभी पता नहीं ({unitLabel})',
  'quantity.about': 'लगभग {amount} {unitLabel} (अपुष्ट)',
  'quantity.exact': '{amount} {unitLabel}',

  'people.one': 'व्यक्ति',
  'people.many': 'लोग',

  'category.meal_packs': 'खाने के पैकेट',
  'category.drinking_water': 'पीने का पानी',
  'category.hygiene_kits': 'स्वच्छता किट',
  'category.shelter_spaces': 'रहने की जगह',

  'unitLabel.meal_packs': 'खाने के पैकेट',
  'unitLabel.drinking_water': 'लीटर',
  'unitLabel.hygiene_kits': 'स्वच्छता किट',
  'unitLabel.shelter_spaces': 'जगहें',
};

const ES: Record<string, string> = {
  'opening.request': 'Dime qué necesitas y dónde estás. Tómate tu tiempo.',
  'opening.facility':
    'Dime qué ha cambiado en tu centro. Por ejemplo, cuántas plazas quedan.',

  'q.intent': '¿Estás pidiendo suministros u ofreciéndolos?',
  'q.intent.need': 'Necesito suministros',
  'q.intent.offer': 'Puedo aportar suministros',
  'q.resources':
    '¿Qué necesitas con más urgencia ahora? Puedes decir comida, agua potable, kits de higiene o plazas de refugio.',
  'q.location':
    '¿Dónde estás? Di el nombre del lugar, escríbelo, usa tu ubicación actual o toca el mapa.',
  'q.location_choice.two':
    'He encontrado dos lugares que podrían coincidir. ¿En cuál estás: {a} o {b}?',
  'q.location_choice.many': 'He encontrado varios lugares que podrían coincidir. ¿En cuál estás?',
  'q.group_scope.yesno': '¿Esta solicitud es para todo el grupo de {n} personas?',
  'q.group_scope.number': '¿Para cuántas personas es? Si no estás seguro, di «no lo sé».',
  'q.quantity_ambiguous':
    'Para {resource}, ¿cuánto necesitas en {unit}? Si no estás seguro, di «no lo sé» y un coordinador lo resolverá.',

  'answer.dont_know': 'No lo sé',
  'answer.yes': 'Sí',
  'answer.no': 'No',

  'ack.recorded': 'He registrado {list}',
  'ack.for_people': 'para {n} personas',
  'ack.updated_people': 'actualizado a {n} personas',
  'ack.at_place': 'en {place}',

  'readback.request': 'Tu solicitud es de {items}{forWhom}{place}.',
  'readback.offer': 'Estás ofreciendo {items}{place}.',
  'readback.for_people': ' para {n} {people}',
  'readback.at_place': ' en {place}',
  'readback.submit_question': '¿La envío?',

  'caveat.quantities': 'Las cantidades aún deben ser confirmadas por un coordinador.',
  'caveat.location': 'El lugar exacto no está confirmado, así que un coordinador lo comprobará.',
  'caveat.danger':
    'Has indicado peligro inmediato. Llama a los servicios de emergencia por teléfono — esta aplicación no puede enviar rescatistas y no ha avisado a nadie por ti.',
  'caveat.skipped': 'Se omitieron algunas preguntas; un coordinador verá qué falta.',

  'submitted.confirmation':
    'Tu solicitud se ha enviado. Tu referencia es {reference}. Todavía ningún coordinador la ha aceptado.',
  'offline.not_sent': 'Guardado en este dispositivo — todavía no enviado.',

  'danger.headline': 'Esto parece una emergencia',
  'danger.body':
    'Has descrito {what}. Llama ahora a los servicios de emergencia si puedes — son los únicos que pueden enviar un equipo de rescate. ReliefRelay coordina suministros y refugio; no puede enviar rescatistas y no ha avisado a nadie por ti. Puedes seguir registrando aquí lo que necesitas, y un coordinador verá que has indicado peligro inmediato para poder escalarlo a los equipos con los que trabaja.',
  'danger.call': 'Llama al {number} — {label}.',
  'danger.still_need': 'Cuando puedas, necesito una cosa más: {question}',
  'danger.generic': 'peligro inmediato',

  'quantity.unknown': 'cantidad aún desconocida ({unitLabel})',
  'quantity.about': 'unos {amount} {unitLabel} (sin confirmar)',
  'quantity.exact': '{amount} {unitLabel}',

  'people.one': 'persona',
  'people.many': 'personas',

  'category.meal_packs': 'Paquetes de comida',
  'category.drinking_water': 'Agua potable',
  'category.hygiene_kits': 'Kits de higiene',
  'category.shelter_spaces': 'Plazas de refugio',

  'unitLabel.meal_packs': 'paquetes de comida',
  'unitLabel.drinking_water': 'litros',
  'unitLabel.hygiene_kits': 'kits de higiene',
  'unitLabel.shelter_spaces': 'plazas',
};

const TA: Record<string, string> = {
  'opening.request': 'உங்களுக்கு என்ன தேவை, நீங்கள் எங்கே இருக்கிறீர்கள் என்று சொல்லுங்கள். அவசரம் இல்லை.',
  'opening.facility': 'உங்கள் மையத்தில் என்ன மாறியுள்ளது என்று சொல்லுங்கள். எடுத்துக்காட்டாக, எத்தனை இடங்கள் மீதம் உள்ளன.',

  'q.intent': 'நீங்கள் பொருட்கள் கேட்கிறீர்களா, அல்லது வழங்க விரும்புகிறீர்களா?',
  'q.intent.need': 'எனக்குப் பொருட்கள் தேவை',
  'q.intent.offer': 'நான் பொருட்கள் வழங்க முடியும்',
  'q.resources':
    'இப்போது உங்களுக்கு மிகவும் தேவையானது என்ன? உணவு, குடிநீர், சுகாதாரப் பெட்டி, அல்லது தங்குமிடம் என்று சொல்லலாம்.',
  'q.location':
    'நீங்கள் எங்கே இருக்கிறீர்கள்? இடத்தின் பெயரைச் சொல்லுங்கள், தட்டச்சு செய்யுங்கள், உங்கள் தற்போதைய இருப்பிடத்தைப் பயன்படுத்துங்கள், அல்லது வரைபடத்தைத் தொடுங்கள்.',
  'q.location_choice.two':
    'பொருந்தக்கூடிய இரண்டு இடங்கள் கிடைத்தன. நீங்கள் எங்கே இருக்கிறீர்கள் — {a}, அல்லது {b}?',
  'q.location_choice.many': 'பொருந்தக்கூடிய சில இடங்கள் கிடைத்தன. நீங்கள் எங்கே இருக்கிறீர்கள்?',
  'q.group_scope.yesno': 'இந்தக் கோரிக்கை {n} பேர் கொண்ட முழுக் குழுவிற்கானதா?',
  'q.group_scope.number': 'இது எத்தனை பேருக்கு? உறுதியாகத் தெரியவில்லை என்றால் “எனக்குத் தெரியாது” என்று சொல்லுங்கள்.',
  'q.quantity_ambiguous':
    '{resource}-க்கு உங்களுக்கு எத்தனை {unit} தேவை? தெரியவில்லை என்றால் “எனக்குத் தெரியாது” என்று சொல்லுங்கள், ஒருங்கிணைப்பாளர் முடிவு செய்வார்.',

  'answer.dont_know': 'எனக்குத் தெரியாது',
  'answer.yes': 'ஆம்',
  'answer.no': 'இல்லை',

  'ack.recorded': 'நான் பதிவு செய்தேன்: {list}',
  'ack.for_people': '{n} பேருக்கு',
  'ack.updated_people': '{n} பேராக மாற்றப்பட்டது',
  'ack.at_place': '{place} இல்',

  'readback.request': 'உங்கள் கோரிக்கை: {items}{forWhom}{place}.',
  'readback.offer': 'நீங்கள் வழங்குவது: {items}{place}.',
  'readback.for_people': ', {n} {people} க்கு',
  'readback.at_place': ', {place} இல்',
  'readback.submit_question': 'இதை நான் சமர்ப்பிக்கட்டுமா?',

  'caveat.quantities': 'பொருட்களின் அளவை ஒருங்கிணைப்பாளர் உறுதிப்படுத்த வேண்டும்.',
  'caveat.location': 'சரியான இடம் இன்னும் உறுதிப்படுத்தப்படவில்லை, ஒருங்கிணைப்பாளர் சரிபார்ப்பார்.',
  'caveat.danger':
    'நீங்கள் உடனடி ஆபத்தைத் தெரிவித்தீர்கள். தயவுசெய்து அவசர சேவைகளை தொலைபேசியில் தொடர்பு கொள்ளுங்கள் — இந்த செயலி மீட்புக் குழுவை அனுப்ப முடியாது, உங்கள் சார்பாக யாரையும் தொடர்பு கொள்ளவில்லை.',
  'caveat.skipped': 'சில கேள்விகள் தவிர்க்கப்பட்டன; எது விடுபட்டது என்பதை ஒருங்கிணைப்பாளர் பார்ப்பார்.',

  'submitted.confirmation':
    'உங்கள் கோரிக்கை சமர்ப்பிக்கப்பட்டது. உங்கள் குறிப்பு எண் {reference}. ஒருங்கிணைப்பாளர் இன்னும் அதை ஏற்கவில்லை.',
  'offline.not_sent': 'இந்தச் சாதனத்தில் சேமிக்கப்பட்டது — இன்னும் அனுப்பப்படவில்லை.',

  'danger.headline': 'இது அவசரநிலை போல் தெரிகிறது',
  'danger.body':
    'நீங்கள் {what} பற்றிக் கூறினீர்கள். முடிந்தால் இப்போதே அவசர சேவைகளை தொலைபேசியில் தொடர்பு கொள்ளுங்கள் — மீட்புக் குழுவை அனுப்பக்கூடியவர்கள் அவர்கள் மட்டுமே. ReliefRelay பொருட்களையும் தங்குமிடத்தையும் ஒருங்கிணைக்கிறது; மீட்புக் குழுவை அனுப்ப முடியாது, உங்கள் சார்பாக யாரையும் தொடர்பு கொள்ளவில்லை. உங்களுக்குத் தேவையானதை இங்கே பதிவு செய்யலாம்; நீங்கள் உடனடி ஆபத்தைத் தெரிவித்ததை ஒருங்கிணைப்பாளர் பார்த்து மேலே தெரிவிப்பார்.',
  'danger.call': '{number} ஐ அழைக்கவும் — {label}.',
  'danger.still_need': 'முடியும்போது, எனக்கு இன்னும் ஒன்று தேவை: {question}',
  'danger.generic': 'உடனடி ஆபத்து',

  'quantity.unknown': 'அளவு இன்னும் தெரியவில்லை ({unitLabel})',
  'quantity.about': 'சுமார் {amount} {unitLabel} (உறுதிப்படுத்தப்படவில்லை)',
  'quantity.exact': '{amount} {unitLabel}',

  'people.one': 'நபர்',
  'people.many': 'பேர்',

  'category.meal_packs': 'உணவுப் பொட்டலங்கள்',
  'category.drinking_water': 'குடிநீர்',
  'category.hygiene_kits': 'சுகாதாரப் பெட்டிகள்',
  'category.shelter_spaces': 'தங்குமிடங்கள்',

  'unitLabel.meal_packs': 'உணவுப் பொட்டலங்கள்',
  'unitLabel.drinking_water': 'லிட்டர்',
  'unitLabel.hygiene_kits': 'சுகாதாரப் பெட்டிகள்',
  'unitLabel.shelter_spaces': 'இடங்கள்',
};

const TE: Record<string, string> = {
  'opening.request': 'మీకు ఏమి కావాలో, మీరు ఎక్కడ ఉన్నారో చెప్పండి. తొందరేమీ లేదు.',
  'opening.facility': 'మీ కేంద్రంలో ఏమి మారిందో చెప్పండి. ఉదాహరణకు, ఎన్ని స్థలాలు మిగిలాయి.',

  'q.intent': 'మీరు సామాగ్రి అడుగుతున్నారా, లేక ఇవ్వాలనుకుంటున్నారా?',
  'q.intent.need': 'నాకు సామాగ్రి కావాలి',
  'q.intent.offer': 'నేను సామాగ్రి ఇవ్వగలను',
  'q.resources':
    'ఇప్పుడు మీకు అత్యవసరంగా ఏమి కావాలి? ఆహారం, తాగునీరు, పరిశుభ్రత కిట్లు, లేదా ఆశ్రయ స్థలం అని చెప్పవచ్చు.',
  'q.location':
    'మీరు ఎక్కడ ఉన్నారు? స్థలం పేరు చెప్పండి, టైప్ చేయండి, మీ ప్రస్తుత స్థానాన్ని ఉపయోగించండి, లేదా మ్యాప్‌ను తాకండి.',
  'q.location_choice.two':
    'సరిపోయే రెండు స్థలాలు దొరికాయి. మీరు ఎక్కడ ఉన్నారు — {a}, లేదా {b}?',
  'q.location_choice.many': 'సరిపోయే కొన్ని స్థలాలు దొరికాయి. మీరు ఎక్కడ ఉన్నారు?',
  'q.group_scope.yesno': 'ఈ అభ్యర్థన {n} మంది ఉన్న మొత్తం బృందం కోసమా?',
  'q.group_scope.number': 'ఇది ఎంత మందికి? ఖచ్చితంగా తెలియకపోతే “నాకు తెలియదు” అని చెప్పండి.',
  'q.quantity_ambiguous':
    '{resource} కోసం మీకు ఎన్ని {unit} కావాలి? తెలియకపోతే “నాకు తెలియదు” అని చెప్పండి, సమన్వయకర్త నిర్ణయిస్తారు.',

  'answer.dont_know': 'నాకు తెలియదు',
  'answer.yes': 'అవును',
  'answer.no': 'కాదు',

  'ack.recorded': 'నేను నమోదు చేశాను: {list}',
  'ack.for_people': '{n} మంది కోసం',
  'ack.updated_people': '{n} మందికి మార్చబడింది',
  'ack.at_place': '{place} వద్ద',

  'readback.request': 'మీ అభ్యర్థన: {items}{forWhom}{place}.',
  'readback.offer': 'మీరు ఇస్తున్నది: {items}{place}.',
  'readback.for_people': ', {n} {people} కోసం',
  'readback.at_place': ', {place} వద్ద',
  'readback.submit_question': 'దీన్ని సమర్పించమంటారా?',

  'caveat.quantities': 'సామాగ్రి పరిమాణాన్ని సమన్వయకర్త ధృవీకరించాలి.',
  'caveat.location': 'ఖచ్చితమైన స్థలం ఇంకా ధృవీకరించబడలేదు, సమన్వయకర్త తనిఖీ చేస్తారు.',
  'caveat.danger':
    'మీరు తక్షణ ప్రమాదాన్ని తెలిపారు. దయచేసి ఫోన్‌లో అత్యవసర సేవలను సంప్రదించండి — ఈ యాప్ సహాయక బృందాన్ని పంపలేదు, మీ తరపున ఎవరినీ సంప్రదించలేదు.',
  'caveat.skipped': 'కొన్ని ప్రశ్నలు దాటవేయబడ్డాయి; ఏమి మిగిలిందో సమన్వయకర్త చూస్తారు.',

  'submitted.confirmation':
    'మీ అభ్యర్థన సమర్పించబడింది. మీ రిఫరెన్స్ {reference}. సమన్వయకర్త ఇంకా దీన్ని ఆమోదించలేదు.',
  'offline.not_sent': 'ఈ పరికరంలో భద్రపరచబడింది — ఇంకా పంపలేదు.',

  'danger.headline': 'ఇది అత్యవసర పరిస్థితిలా ఉంది',
  'danger.body':
    'మీరు {what} గురించి చెప్పారు. వీలైతే ఇప్పుడే ఫోన్‌లో అత్యవసర సేవలను సంప్రదించండి — సహాయక బృందాన్ని పంపగలిగేది వారే. ReliefRelay సామాగ్రి, ఆశ్రయం సమన్వయం చేస్తుంది; సహాయక బృందాన్ని పంపలేదు, మీ తరపున ఎవరినీ సంప్రదించలేదు. మీకు కావలసినది ఇక్కడ నమోదు చేయవచ్చు; మీరు తక్షణ ప్రమాదాన్ని తెలిపారని సమన్వయకర్త చూసి పైకి తెలియజేస్తారు.',
  'danger.call': '{number} కు కాల్ చేయండి — {label}.',
  'danger.still_need': 'వీలైనప్పుడు, నాకు ఇంకొకటి కావాలి: {question}',
  'danger.generic': 'తక్షణ ప్రమాదం',

  'quantity.unknown': 'పరిమాణం ఇంకా తెలియదు ({unitLabel})',
  'quantity.about': 'సుమారు {amount} {unitLabel} (ధృవీకరించబడలేదు)',
  'quantity.exact': '{amount} {unitLabel}',

  'people.one': 'వ్యక్తి',
  'people.many': 'మంది',

  'category.meal_packs': 'ఆహార ప్యాకెట్లు',
  'category.drinking_water': 'తాగునీరు',
  'category.hygiene_kits': 'పరిశుభ్రత కిట్లు',
  'category.shelter_spaces': 'ఆశ్రయ స్థలాలు',

  'unitLabel.meal_packs': 'ఆహార ప్యాకెట్లు',
  'unitLabel.drinking_water': 'లీటర్లు',
  'unitLabel.hygiene_kits': 'పరిశుభ్రత కిట్లు',
  'unitLabel.shelter_spaces': 'స్థలాలు',
};

const PENDING_REVIEW =
  'Drafted for this prototype and not yet checked by a native speaker. The structured data is unaffected; only the wording is.';

export const CATALOGUES: Record<SupportedLanguage, Catalogue> = {
  en: { label: 'English', englishName: 'English', reviewed: true, strings: EN },
  hi: { label: 'हिन्दी', englishName: 'Hindi', reviewed: false, reviewNote: PENDING_REVIEW, strings: HI },
  ta: { label: 'தமிழ்', englishName: 'Tamil', reviewed: false, reviewNote: PENDING_REVIEW, strings: TA },
  te: { label: 'తెలుగు', englishName: 'Telugu', reviewed: false, reviewNote: PENDING_REVIEW, strings: TE },
  es: { label: 'Español', englishName: 'Spanish', reviewed: false, reviewNote: PENDING_REVIEW, strings: ES },
};

export function isSupported(language: string): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Looks up one string. An unknown language or a missing key falls back to
 * English rather than showing a key name — a person in a flood should never
 * be shown `q.location` because a catalogue was incomplete.
 */
export function t(
  language: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const catalogue = isSupported(language) ? CATALOGUES[language] : CATALOGUES.en;
  const template = catalogue.strings[key] ?? CATALOGUES.en.strings[key];
  if (!template) return key;
  return interpolate(template, params);
}

/** Whether a given string exists in that language, for reporting coverage. */
export function hasTranslation(language: string, key: string): boolean {
  return isSupported(language) && key in CATALOGUES[language].strings;
}

export function catalogueFor(language: string): Catalogue {
  return isSupported(language) ? CATALOGUES[language] : CATALOGUES.en;
}

/** Every key English defines, for the completeness test. */
export const ALL_KEYS = Object.keys(EN);
