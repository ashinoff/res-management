#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pandas as pd
import sys
import json
from datetime import datetime
from collections import defaultdict
import re

class RIMAnalyzer:
    def __init__(self):
        self.voltage_events = []
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ файла журнала событий РИМ"""
        try:
            # Читаем Excel файл
            df = pd.read_excel(filepath, header=0)
            
            # Ожидаемые колонки: Дата/время, Событие, U(В), Длительность(сек)
            results = {
                'processed': True,
                'errors': [],
                'overvoltage': defaultdict(list),  # Перенапряжения
                'undervoltage': defaultdict(list)   # Провалы
            }
            
            for idx, row in df.iterrows():
                try:
                    event = str(row.get('Событие', ''))
                    duration = float(row.get('Длительность', 0))
                    voltage = float(str(row.get('U', 0)).replace(',', '.'))
                    date_str = pd.to_datetime(row.get('Дата/время')).strftime('%d.%m.%Y')
                    
                    # Фильтруем только события длительностью > 60 сек
                    if duration <= 60:
                        continue
                    
                    # Перенапряжения
                    if 'перенапряжение окончание' in event:
                        phase = self._extract_phase(event)
                        if phase:
                            results['overvoltage'][phase].append({
                                'date': date_str,
                                'voltage': voltage,
                                'month': int(date_str.split('.')[1])
                            })
                    
                    # Провалы (игнорируем Umin = 11.50)
                    elif 'провал окончание' in event:
                        if abs(voltage - 11.5) < 0.001:
                            continue
                        phase = self._extract_phase(event)
                        if phase:
                            results['undervoltage'][phase].append({
                                'date': date_str,
                                'voltage': voltage,
                                'month': int(date_str.split('.')[1])
                            })
                            
                except Exception as e:
                    results['errors'].append(f"Строка {idx+2}: {str(e)}")
            
            # Формируем итоговую строку
            summary = self._generate_summary(results)
            
            return {
                'success': True,
                'summary': summary,
                'has_errors': bool(results['overvoltage'] or results['undervoltage']),
                'details': {
                    'overvoltage': dict(results['overvoltage']),
                    'undervoltage': dict(results['undervoltage'])
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'has_errors': False
            }
    
    def _extract_phase(self, event_text):
        """Извлечение фазы из текста события"""
        match = re.search(r'Фаза ([ABC])', event_text)
        return match.group(1) if match else None
    
    def _generate_summary(self, results):
        """Генерация итоговой строки с результатами"""
        summary_parts = []
        
        # Обработка перенапряжений
        for phase, events in results['overvoltage'].items():
            if events:
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                max_voltage = max(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}>10% – {count} шт, Umax={max_voltage:.2f}"
                )
        
        # Обработка провалов
        for phase, events in results['undervoltage'].items():
            if events:
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                min_voltage = min(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}<10% – {count} шт, Umin={min_voltage:.2f}"
                )
        
        return '; '.join(summary_parts) if summary_parts else "Напряжение в пределах ГОСТ"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No file path provided'}))
        sys.exit(1)
    
    analyzer = RIMAnalyzer()
    result = analyzer.analyze_file(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
