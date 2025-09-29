#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
import csv
import pandas as pd
import re
from collections import defaultdict

class RIMAnalyzer:
    def __init__(self):
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ файла журнала событий через промежуточный CSV"""
        try:
            # Сначала читаем первую строку, чтобы понять - это заголовок или данные
            df_check = pd.read_excel(filepath, header=None, nrows=1)
            first_row = df_check.iloc[0, 0] if not df_check.empty else ""
            
            # Проверяем, является ли первая строка заголовком
            has_header = False
            if isinstance(first_row, str):
                if 'Время' in first_row or not re.match(r'\d{2}\.\d{2}\.\d{4}', str(first_row)):
                    has_header = True
            
            # Читаем файл с учетом наличия заголовков
            if has_header:
                df = pd.read_excel(filepath, header=None, skiprows=1)
            else:
                df = pd.read_excel(filepath, header=None)
            
            # Сохраняем во временный CSV
            temp_csv = filepath + '.temp.csv'
            df.to_csv(temp_csv, index=False, header=False)
            
            # Теперь читаем CSV
            events_data = {
                'overvoltage': {'A': [], 'B': [], 'C': []},
                'undervoltage': {'A': [], 'B': [], 'C': []}
            }
            
            with open(temp_csv, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                rows = list(reader)
            
            # Удаляем временный файл
            import os
            os.remove(temp_csv)
            
            # Обрабатываем все строки (заголовки уже пропущены при чтении Excel)
            for idx, row in enumerate(rows):
                try:
                    if len(row) < 5:
                        continue
                    
                    # Колонки: Время | Событие | Напряжение, В | Глубина от U ном., % | Продолж., с
                    datetime_str = row[0]
                    event = row[1]
                    
                    # Парсим числа с запятой
                    try:
                        voltage = float(row[2].replace(',', '.'))
                    except:
                        continue
                        
                    try:
                        percent = float(row[3].replace(',', '.'))
                    except:
                        percent = 0
                        
                    try:
                        duration = float(row[4].replace(',', '.'))
                    except:
                        continue
                    
                    # Фильтры
                    if duration <= 60:
                        continue
                    if abs(voltage - 11.50) < 0.001 or voltage == 0:
                        continue
                    
                    # Извлекаем месяц из даты
                    date_match = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', datetime_str)
                    if not date_match:
                        continue
                    month = int(date_match.group(2))
                    
                    # Определяем фазу и тип события
                    phase = None
                    event_type = None
                    event_lower = event.lower()
                    
                    if 'фаза a' in event_lower:
                        phase = 'A'
                    elif 'фаза b' in event_lower:
                        phase = 'B'
                    elif 'фаза c' in event_lower:
                        phase = 'C'
                    
                    if phase and 'окончание' in event_lower:
                        if 'провал' in event_lower:
                            event_type = 'undervoltage'
                        elif 'перенапряжение' in event_lower:
                            event_type = 'overvoltage'
                    
                    if phase and event_type:
                        events_data[event_type][phase].append({
                            'voltage': voltage,
                            'month': month,
                            'duration': duration
                        })
                        
                except Exception as e:
                    # Для отладки можно раскомментировать
                    # print(f"Error processing row {idx}: {e}", file=sys.stderr)
                    continue
            
            return self._generate_result(events_data)
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Ошибка анализа: {str(e)}",
                'has_errors': False
            }
    
    def _generate_result(self, events_data):
        summary_parts = []
        has_errors = False
        details = {'overvoltage': {}, 'undervoltage': {}}
        
        # Обработка перенапряжений
        for phase in ['A', 'B', 'C']:
            events = events_data['overvoltage'][phase]
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month, max_month = min(months), max(months)
                period = self.ru_months[min_month-1] if min_month == max_month else f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                voltages = [e['voltage'] for e in events]
                max_voltage = max(voltages)
                min_voltage_in_overvoltage = min(voltages)
                count = len(events)
                
                # Расчет процентов для диапазона
                min_percent = ((min_voltage_in_overvoltage - 220) / 220) * 100
                max_percent = ((max_voltage - 220) / 220) * 100
                
                summary_parts.append(f"Фаза {phase}: Перенапряжение {min_percent:.1f}-{max_percent:.1f}% (max {max_voltage:.0f}В) ({period}) - {count} событий")
                details['overvoltage'][f'phase_{phase}'] = {'count': count, 'max': max_voltage, 'period': period}
        
        # Обработка провалов
        for phase in ['A', 'B', 'C']:
            events = events_data['undervoltage'][phase]
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month, max_month = min(months), max(months)
                period = self.ru_months[min_month-1] if min_month == max_month else f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                voltages = [e['voltage'] for e in events]
                min_voltage = min(voltages)
                max_voltage_in_undervoltage = max(voltages)
                count = len(events)
                
                # Расчет процентов для диапазона
                min_percent = ((220 - max_voltage_in_undervoltage) / 220) * 100
                max_percent = ((220 - min_voltage) / 220) * 100
                
                summary_parts.append(f"Фаза {phase}: Провал {min_percent:.1f}-{max_percent:.1f}% (min {min_voltage:.0f}В) ({period}) - {count} событий")
                details['undervoltage'][f'phase_{phase}'] = {'count': count, 'min': min_voltage, 'period': period}
        
        if not has_errors:
            summary = "Напряжение в пределах ГОСТ"
        else:
            summary = '; '.join(summary_parts)
        
        return {'success': True, 'summary': summary, 'has_errors': has_errors, 'details': details}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No file path provided'}))
        sys.exit(1)
    
    analyzer = RIMAnalyzer()
    result = analyzer.analyze_file(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
