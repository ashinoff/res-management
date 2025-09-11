def _generate_result(self, events_data):
    """Генерация результата анализа"""
    summary_parts = []
    has_errors = False
    details = {
        'overvoltage': {},
        'undervoltage': {}
    }
    
    # Обработка перенапряжений
    for phase in ['A', 'B', 'C']:
        events = events_data['overvoltage'][phase]
        if len(events) > 10:
            has_errors = True
            months = [e['month'] for e in events]
            min_month = min(months)
            max_month = max(months)
            
            if min_month == max_month:
                period = self.ru_months[min_month-1]
            else:
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
            
            voltages = [e['voltage'] for e in events]
            max_voltage = max(voltages)
            min_voltage_in_overvoltage = min(voltages)
            count = len(events)
            
            # Расчет процентов для диапазона
            min_percent = ((min_voltage_in_overvoltage - 220) / 220) * 100
            max_percent = ((max_voltage - 220) / 220) * 100
            
            summary_parts.append(
                f"Фаза {phase}: Перенапряжение {min_percent:.1f}-{max_percent:.1f}% (max {max_voltage:.0f}В) ({period}) - {count} событий"
            )
            
            details['overvoltage'][f'phase_{phase}'] = {
                'count': count,
                'max': max_voltage,
                'period': period
            }
    
    # Обработка провалов
    for phase in ['A', 'B', 'C']:
        events = events_data['undervoltage'][phase]
        if len(events) > 10:
            has_errors = True
            months = [e['month'] for e in events]
            min_month = min(months)
            max_month = max(months)
            
            if min_month == max_month:
                period = self.ru_months[min_month-1]
            else:
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
            
            voltages = [e['voltage'] for e in events]
            min_voltage = min(voltages)
            max_voltage_in_undervoltage = max(voltages)
            count = len(events)
            
            # Расчет процентов для диапазона
            min_percent = ((220 - max_voltage_in_undervoltage) / 220) * 100
            max_percent = ((220 - min_voltage) / 220) * 100
            
            summary_parts.append(
                f"Фаза {phase}: Провал {min_percent:.1f}-{max_percent:.1f}% (min {min_voltage:.0f}В) ({period}) - {count} событий"
            )
            
            details['undervoltage'][f'phase_{phase}'] = {
                'count': count,
                'min': min_voltage,
                'period': period
            }
