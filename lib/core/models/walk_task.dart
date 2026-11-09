class WalkTask {
  WalkTask({
    required this.id,
    required this.petName,
    required this.ownerName,
    required this.address,
    required this.timeWindow,
    required this.medicalAlerts,
    this.isCompleted = false,
    this.isInProgress = false,
  });

  final String id;
  final String petName;
  final String ownerName;
  final String address;
  final String timeWindow;
  final List<String> medicalAlerts;
  bool isCompleted;
  bool isInProgress;
}
