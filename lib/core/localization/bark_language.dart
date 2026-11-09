import 'package:flutter/material.dart' hide Text;
import 'package:flutter/material.dart' as material show Text;

enum BarkLanguage { english, spanish }

final ValueNotifier<BarkLanguage> barkLanguage = ValueNotifier(
  BarkLanguage.english,
);

const Map<String, String> _englishTranslations = {
  'Selecciona tu tipo de cuenta': 'Choose your account type',
  'Selecciona el perfil que deseas simular': 'Choose a profile to preview',
  'Vista Shopper (Operaciones)': 'Shopper view (Operations)',
  'Vista Cliente (Dueño de Mascota)': 'Client view (Pet Owner)',
  'Vista Finanzas (Admin)': 'Finance view (Admin)',
  'Continuar al registro': 'Continue to sign up',
  'Abrir demo integrada': 'Open unified demo',
  'Selecciona idioma': 'Choose language',
  'EN LÍNEA': 'ONLINE',
  'OFFLINE': 'OFFLINE',
  'Siguiente Servicio': 'Next service',
  'Ruta del Día': "Today's route",
  'Paseos Hoy': 'Walks today',
  'Ganancias': 'Earnings',
  'Rating': 'Rating',
  'PASEO + SUMINISTROS': 'WALK + SUPPLIES',
  'Dueño: Carlos M. • Kit verificado': 'Owner: Carlos M. • Kit verified',
  'Iniciar Servicio': 'Start service',
  'Finalizar Servicio': 'Finish service',
  'Servicio iniciado para Max.': 'Service started for Max.',
  'Servicio finalizado.': 'Service completed.',
  'Ver solicitudes y rutas': 'View requests and routes',
  'Escanear Kit': 'Scan kit',
  'El escáner QR aún no está configurado en esta demo.':
      'QR scanning is not configured in this demo yet.',
  'Encuentra paseadores\nprofesionales cerca de ti':
      'Find professional dog walkers near you',
  'Paseadores certificados y perros felices':
      'Certified walkers and happy dogs',
  'Conoce a tu paseador y consulta la información de salud de tu mascota.':
      'Meet your walker and access your pet’s health information.',
  'Registro de Dueño de Mascota': 'Pet Owner Registration',
  'Registro de Paseador (Shopper)': 'Dog Walker Registration',
  'Seguimiento detenido': 'Tracking stopped',
  'Solicitando acceso al GPS...': 'Requesting GPS access...',
  'Activa los servicios de ubicación del dispositivo.':
      'Turn on location services on your device.',
  'Permite el acceso a la ubicación para iniciar.':
      'Allow location access to get started.',
  'GPS activo en este dispositivo': 'GPS active on this device',
  'Se perdió la señal GPS': 'GPS signal lost',
  'No se pudo obtener la ubicación. Inténtalo de nuevo.':
      'Could not get your location. Please try again.',
  'Inicia el GPS para compartir una ubicación.':
      'Start GPS to share a location.',
  'No se pudo abrir Maps.': 'Could not open Maps.',
  'No hay una aplicación de llamadas disponible.':
      'No calling app is available.',
  'No hay una aplicación de mensajes disponible.':
      'No messaging app is available.',
  'Hola, ¿cómo va el paseo de Max?': 'Hi, how is Max’s walk going?',
  'Seguimiento del paseo': 'Walk tracking',
  'PASEADOR: ALEX M.': 'WALKER: ALEX M.',
  'TIEMPO DE PASEO': 'WALK DURATION',
  'Buscando GPS...': 'Getting GPS...',
  'Detener seguimiento': 'Stop tracking',
  'Iniciar seguimiento': 'Start tracking',
  'Ubicación': 'Location',
  'La ubicación aparecerá al iniciar el GPS':
      'Location will appear when GPS starts',
  'Abrir ubicación en Maps': 'Open location in Maps',
  'El GPS mostrado corresponde a este dispositivo. El seguimiento remoto del paseador requiere una cuenta y un servicio de ubicación compartida.': 'The GPS shown is for this device. Remote walker tracking requires an account and a location-sharing service.',
  'Paseador de Max': 'Max’s dog walker',
  'Max · Golden Retriever · 1 hora': 'Max · Golden Retriever · 1 hour',
  'Llamar': 'Call',
  'Mensaje': 'Message',
  'Radar de paseos': 'Walk radar',
  'Recibiendo solicitudes': 'Receiving requests',
  'Desconectado': 'Offline',
  'Conéctate para ver solicitudes cercanas.':
      'Go online to see nearby requests.',
  'Tarifa total: \$50': 'Total fare: \$50',
  'Tarifa total: \$30': 'Total fare: \$30',
  'Luna · French Bulldog · 30 min': 'Luna · French Bulldog · 30 min',
  'Abrir dirección en Maps': 'Open address in Maps',
  'Solicitud aceptada. Contacta al dueño para coordinar.':
      'Request accepted. Contact the owner to coordinate.',
  'Aceptar paseo': 'Accept walk',
  'El servicio requiere conexión.': 'Go online to start a service.',
  'Próximas paradas · Homewood': 'Upcoming stops · Homewood',
  'Plan de ruta · demo': 'Route plan · demo',
  '0 completadas · 3 pendientes': '0 completed · 3 remaining',
  'Homewood': 'Homewood',
  'SHOPPER ROUTE · DEMO': 'SHOPPER ROUTE · DEMO',
  'PENDIENTE': 'UP NEXT',
  'EN PASEO': 'IN PROGRESS',
  'COMPLETADO': 'COMPLETE',
  'Escanear QR para iniciar · demo': 'Scan QR to start · demo',
  'Escanear para finalizar · demo': 'Scan to finish · demo',
  'Completado': 'Completed',
  'Simulación de escaneo QR · Max': 'QR scan simulation · Max',
  'La cámara todavía no está conectada en esta demo.':
      'The camera scanner is not connected in this demo.',
  'Simular lectura de QR': 'Simulate QR scan',
  'Simular fin del paseo': 'Simulate walk completion',
  'Paseo demo iniciado. No se verificó QR ni GPS.':
      'Demo walk started. No QR or GPS was verified.',
  'Paseo demo marcado como terminado. No se verificó QR ni GPS.':
      'Demo walk marked complete. No QR or GPS was verified.',
  'Ruta de ejemplo. No hay optimización con IA ni GPS en vivo conectado.':
      'Sample route only. No AI optimization or live GPS is connected.',
  'Alergia al pollo': 'Chicken allergy',
  'Sensibilidad en patas': 'Paw sensitivity',
  'Paseo Estándar (Max)': 'Standard Walk (Max)',
  'Carlos M. (Cliente)': 'Carlos M. (Client)',
  'Auto-Ship Suministros (Snacks)': 'Auto-Ship Supplies (Snacks)',
  'Elena R. (Cliente)': 'Elena R. (Client)',
  'Liquidación Semanal Shopper': 'Weekly Shopper Payout',
  'Marcos P. (Shopper)': 'Marcos P. (Shopper)',
  'Hoy, 10:45 AM': 'Today, 10:45 AM',
  'Hoy, 09:15 AM': 'Today, 09:15 AM',
  'Ayer': 'Yesterday',
  'Procesando': 'Processing',
  'Transferido': 'Transferred',
  'Confirma la información para continuar.':
      'Confirm the information to continue.',
  'Registro de dueño y mascota': 'Owner & Pet Registration',
  'Información del perfil': 'Profile information',
  'Completa los datos del dueño, tu mascota y su veterinario.':
      'Add the owner, pet, and veterinarian details.',
  'Nombre del propietario': 'Owner name',
  'Dirección, ciudad, estado y ZIP': 'Street address, city, state, and ZIP',
  'Nombre de la mascota': 'Pet name',
  'Raza': 'Breed',
  'Clínica veterinaria y teléfono': 'Veterinary clinic and phone',
  'Certificado de vacunación': 'Vaccination certificate',
  'La carga cifrada de documentos se habilitará al conectar el almacenamiento seguro.': 'Encrypted document uploads will be available when secure storage is connected.',
  'Configurar carga segura': 'Set up secure upload',
  'Confirmo que la información del perfil es correcta.':
      'I confirm the profile information is correct.',
  'Enviar registro de demostración': 'Submit demo registration',
  'Registro de paseador': 'Walker registration',
  'Se requiere autorización para continuar.':
      'Authorization is required to continue.',
  'Identidad y requisitos': 'Identity & requirements',
  'Crea tu perfil para iniciar una verificación de identidad segura.':
      'Create your profile to begin secure identity verification.',
  'Nombre legal completo': 'Full legal name',
  'Correo electrónico': 'Email address',
  'Teléfono': 'Phone number',
  'Estado de residencia': 'State of residence',
  'Verificación de identidad y antecedentes': 'Identity & background check',
  'La integración con un proveedor aprobado aún no está configurada. No introduzcas SSN/ITIN, licencia ni selfies en esta demo.': 'An approved verification provider is not configured yet. Do not enter an SSN/ITIN, ID, or selfie in this demo.',
  'Ver requisitos de seguridad': 'View security requirements',
  'Autorizo iniciar la verificación cuando se configure el proveedor seguro.':
      'I authorize verification once a secure provider is configured.',
  'Verificación en proceso': 'Verification in progress',
  'Perfil de paseador en revisión': 'Walker profile under review',
  'Perfil de dueño listo para verificar':
      'Owner profile ready for verification',
  'Esta es una demostración: no se envió información ni se ejecutó una verificación real.': 'This is a demo: no information was submitted and no real verification was performed.',
  'Simular aprobación demo': 'Simulate demo approval',
  'Este campo es obligatorio.': 'This field is required.',
  'Introduce un correo válido.': 'Enter a valid email address.',
  'Integración segura pendiente': 'Secure integration pending',
  'Antes de recopilar documentos, datos fiscales o biométricos, conecta un proveedor de verificación aprobado y almacenamiento cifrado.': 'Before collecting documents, tax details, or biometrics, connect an approved verification provider and encrypted storage.',
  'Entendido': 'Got it',
};

String localize(String value, BarkLanguage language) {
  if (language == BarkLanguage.spanish) return value;
  if (value.startsWith('Tiempo restante: ')) {
    return value.replaceFirst('Tiempo restante:', 'Time remaining:');
  }
  if (value.startsWith('Precisión: ')) {
    return value.replaceFirst('Precisión:', 'Accuracy:');
  }
  return _englishTranslations[value] ?? value;
}

class Text extends StatelessWidget {
  const Text(
    this.data, {
    super.key,
    this.style,
    this.strutStyle,
    this.textAlign,
    this.textDirection,
    this.locale,
    this.softWrap,
    this.overflow,
    this.textScaler,
    this.maxLines,
    this.semanticsLabel,
    this.textWidthBasis,
    this.textHeightBehavior,
    this.selectionColor,
  });

  final String data;
  final TextStyle? style;
  final StrutStyle? strutStyle;
  final TextAlign? textAlign;
  final TextDirection? textDirection;
  final Locale? locale;
  final bool? softWrap;
  final TextOverflow? overflow;
  final TextScaler? textScaler;
  final int? maxLines;
  final String? semanticsLabel;
  final TextWidthBasis? textWidthBasis;
  final TextHeightBehavior? textHeightBehavior;
  final Color? selectionColor;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<BarkLanguage>(
      valueListenable: barkLanguage,
      builder: (context, language, child) => material.Text(
        localize(data, language),
        style: style,
        strutStyle: strutStyle,
        textAlign: textAlign,
        textDirection: textDirection,
        locale: locale,
        softWrap: softWrap,
        overflow: overflow,
        textScaler: textScaler,
        maxLines: maxLines,
        semanticsLabel: semanticsLabel,
        textWidthBasis: textWidthBasis,
        textHeightBehavior: textHeightBehavior,
        selectionColor: selectionColor,
      ),
    );
  }
}
