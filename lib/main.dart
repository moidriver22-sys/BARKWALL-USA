import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/localization/bark_language.dart';
import 'core/theme/bark_theme.dart';
import 'features/home/presentation/role_selection_screen.dart';

export 'core/localization/bark_language.dart' show BarkLanguage, barkLanguage;
export 'core/models/bark_walk_role.dart' show BarkWalkRole;
export 'features/home/presentation/role_selection_screen.dart'
    show RoleSelectionScreen;
export 'features/home/presentation/barkwall_portal_screen.dart'
    show BarkWallPortalScreen;
export 'features/home/presentation/role_selector_screen.dart'
    show RoleSelectorScreen;
export 'features/home/presentation/client_home_screen.dart'
    show ClientHomeScreen;
export 'features/admin_finance/presentation/barkwall_admin_finance_screen.dart'
    show BarkWallAdminFinanceScreen;
export 'features/pet_profile/presentation/owner_registration_screen.dart'
    show OwnerRegistrationScreen;
export 'features/pet_profile/presentation/barkwall_ai_advisor_screen.dart'
    show BarkWallAIAdvisorScreen;
export 'features/pet_tracker/presentation/owner_tracking_screen.dart'
    show OwnerTrackingScreen;
export 'features/registration/presentation/pending_approval_screen.dart'
    show PendingApprovalScreen;
export 'features/shopper/presentation/walker_radar_screen.dart'
    show OrderCard, WalkerRadarScreen;
export 'features/shopper/presentation/shopper_home_screen.dart'
    show ShopperHomeScreen;
export 'features/shopper/presentation/shopper_route_qr_screen.dart'
    show ShopperRouteAndQRScreen;
export 'features/shopper/presentation/walker_registration_screen.dart'
    show WalkerRegistrationScreen;

void main() {
  runApp(const DogWalkerApp());
}

class DogWalkerApp extends StatelessWidget {
  const DogWalkerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<BarkLanguage>(
      valueListenable: barkLanguage,
      builder: (context, language, child) => MaterialApp(
        locale: Locale(language == BarkLanguage.english ? 'en' : 'es'),
        supportedLocales: const [Locale('en'), Locale('es')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        title: 'BarkWalk USA',
        debugShowCheckedModeBanner: false,
        theme: BarkTheme.light,
        home: const RoleSelectionScreen(),
      ),
    );
  }
}
