import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../domain/transaction_item.dart';

class BarkWallAdminFinanceScreen extends StatefulWidget {
  const BarkWallAdminFinanceScreen({super.key});

  @override
  State<BarkWallAdminFinanceScreen> createState() =>
      _BarkWallAdminFinanceScreenState();
}

class _BarkWallAdminFinanceScreenState
    extends State<BarkWallAdminFinanceScreen> {
  static const Color _primaryGreen = Color(0xFF1B4D3E);
  static const Color _darkBackground = Color(0xFF121212);
  static const Color _cardBackground = Color(0xFF1A1A1A);
  static const Color _accentGreen = Color(0xFF2ECC71);
  static const Color _subtleGreenTint = Color(0xFF132E25);

  bool _dynamicPricingEnabled = true;

  final List<TransactionItem> _transactions = const [
    TransactionItem(
      id: 'TXN-9021',
      serviceName: 'Paseo Estándar (Max)',
      clientOrShopper: 'Carlos M. (Cliente)',
      amount: 25,
      timestamp: 'Hoy, 10:45 AM',
      status: 'Completado',
    ),
    TransactionItem(
      id: 'TXN-9022',
      serviceName: 'Auto-Ship Suministros (Snacks)',
      clientOrShopper: 'Elena R. (Cliente)',
      amount: 42.5,
      timestamp: 'Hoy, 09:15 AM',
      status: 'Procesando',
    ),
    TransactionItem(
      id: 'TXN-9023',
      serviceName: 'Liquidación Semanal Shopper',
      clientOrShopper: 'Marcos P. (Shopper)',
      amount: 380,
      timestamp: 'Ayer',
      status: 'Transferido',
    ),
  ];

  bool get _isEnglish => barkLanguage.value == BarkLanguage.english;

  @override
  Widget build(BuildContext context) {
    final isEnglish = _isEnglish;
    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        backgroundColor: _primaryGreen,
        foregroundColor: Colors.white,
        title: Row(
          children: [
            const Icon(
              Icons.account_balance_wallet_rounded,
              color: _accentGreen,
              size: 22,
            ),
            const SizedBox(width: 10),
            Text(
              isEnglish ? 'FINANCE & AUTOMATION · DEMO' : 'FINANZAS · DEMO',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildRevenueOverview(isEnglish),
          const SizedBox(height: 16),
          _buildPricingControl(isEnglish),
          const SizedBox(height: 24),
          Text(
            isEnglish
                ? 'Recent transactions · sample data'
                : 'Transacciones recientes · datos de muestra',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          for (final transaction in _transactions)
            _buildTransactionCard(transaction),
          const SizedBox(height: 8),
          Text(
            isEnglish
                ? 'Demo data only. No payments, payouts, or pricing rules are connected.'
                : 'Solo datos de demo. No hay pagos, transferencias ni reglas de precio conectados.',
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildRevenueOverview(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accentGreen.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  isEnglish
                      ? 'Sample gross volume · Homewood'
                      : 'Ingresos brutos de muestra · Homewood',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
              const Icon(Icons.trending_up, color: _accentGreen, size: 18),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            '\$1,480.00',
            style: TextStyle(
              color: Colors.white,
              fontSize: 26,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _buildMetricPill(
                isEnglish ? 'Auto-collection · demo' : 'Cobros auto · demo',
                '100%',
              ),
              _buildMetricPill(
                isEnglish ? 'Platform fee · example' : 'Comisión · ejemplo',
                '15%',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricPill(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: _subtleGreenTint,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '$label: ',
            style: const TextStyle(color: Colors.white70, fontSize: 11),
          ),
          Text(
            value,
            style: const TextStyle(
              color: _accentGreen,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPricingControl(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEnglish
                      ? 'Dynamic pricing · simulation'
                      : 'Precios dinámicos · simulación',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isEnglish
                      ? 'No pricing engine is connected.'
                      : 'No hay un motor de precios conectado.',
                  style: const TextStyle(color: Colors.white60, fontSize: 11),
                ),
              ],
            ),
          ),
          Switch(
            value: _dynamicPricingEnabled,
            activeThumbColor: _accentGreen,
            activeTrackColor: _primaryGreen,
            onChanged: (value) =>
                setState(() => _dynamicPricingEnabled = value),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionCard(TransactionItem transaction) {
    final statusColor = transaction.status == 'Procesando'
        ? Colors.amber
        : _accentGreen;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _subtleGreenTint,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Icons.receipt_long_outlined,
              color: _accentGreen,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  transaction.serviceName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '${transaction.clientOrShopper} · ${transaction.timestamp}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
                const SizedBox(height: 5),
                Text(
                  localize(transaction.status, barkLanguage.value),
                  style: TextStyle(color: statusColor, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '\$${transaction.amount.toStringAsFixed(2)}',
            style: const TextStyle(
              color: _accentGreen,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
