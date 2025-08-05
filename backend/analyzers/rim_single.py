#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
import csv
from datetime import datetime
from collections import defaultdict

class RIMAnalyzer:
    def __init__(self):
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ XLS файла как CSV (Excel сохраняет как CSV с табуляцией)"""
        try:
            results = {
                'processed': True,
                'errors': [],
                'overvoltage': defaultdict(list),
                'undervoltage': defaultdict(list)
            }
            
            # Читаем файл как текст с табуляцией
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Пропускаем первые 2 строки (заголовки)
            for i, line in enumerate(lines[2:], start=3):
                try:
                    # Разбираем строку по табуляции
                    parts = line.strip().split('\t')
                    if len(parts) < 5:
                        continue
                    
                    datetime_str = parts[0]
                    event = parts[1]
                    voltage_str = parts[2].replace(',', '.')
                    duration_str = parts[4]
                    
                    # Парсим дату
                    try:
                        date_parts = datetime_str.split()[0].split('.')
                        if len(date_parts) == 3:
                            day, month, year = date_parts
                            month_num = int(month)
                        else:
                            continue
                    except:
                        continue
                    
                    # Парсим напряжение и длительность
                    try:
                        voltage = float(voltage_str)
                        duration = float(duration_str) if duration_str else 0
                    except:
                        voltage = 0
                        duration = 0
                    
                    # Фильтруем только события длительностью > 60 сек
                    if duration <= 60:
                        continue
                    
                    # Анализируем события
                    if 'пропадание напряжения' in event.lower():
                        phase = None
                        if 'Фаза A' in event or 'фаза a' in event.lower():
                            phase = 'A'
                        elif 'Фаза B' in event or 'фаза b' in event.lower():
                            phase = 'B'
                        elif 'Фаза C' in event or 'фаза c' in event.lower():
                            phase = 'C'
                        
                        if phase and abs(voltage - 11.5) > 0.001:
                            results['undervoltage'][phase].append({
                                'date': datetime_str.split()[0],
                                'voltage': voltage,
                                'month': month_num
                            })
                    
                    # Перенапряжения (если встретятся)
                    elif 'перенапряжение' in event.lower() and 'окончание' in event.lower():
                        phase = None
                        if 'Фаза A' in event or 'фаза a' in event.lower():
                            phase = 'A'
                        elif 'Фаза B' in event or 'фаза b' in event.lower():
                            phase = 'B'
                        elif 'Фаза C' in event or 'фаза c' in event.lower():
                            phase = 'C'
                        
                        if phase:
                            results['overvoltage'][phase].append({
                                'date': datetime_str.split()[0],
                                'voltage': voltage,
                                'month': month_num
                            })
                    
                except Exception as e:
                    results['errors'].append(f"Строка {i}: {str(e)}")
            
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
                'error': f"Ошибка анализа файла: {str(e)}",
                'has_errors': False
            }
    
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
                    f"{period} U{phase.lower()}>10% – {count} раз(а), Umax={max_voltage:.2f}"
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
                    f"{period} U{phase.lower()}<10% – {count} раз(а), Umin={min_voltage:.2f}"
                )
        
        return '; '.join(summary_parts) if summary_parts else "Напряжение в пределах ГОСТ"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No file path provided'}))
        sys.exit(1)
    
    try:
        analyzer = RIMAnalyzer()
        result = analyzer.analyze_file(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
