class TransactionItem {
  const TransactionItem({
    required this.id,
    required this.serviceName,
    required this.clientOrShopper,
    required this.amount,
    required this.timestamp,
    required this.status,
  });

  final String id;
  final String serviceName;
  final String clientOrShopper;
  final double amount;
  final String timestamp;
  final String status;
}
