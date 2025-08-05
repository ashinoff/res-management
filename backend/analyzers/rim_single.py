#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from collections import defaultdict

class RIMAnalyzer:
    def __init__(self):
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ XLS файла журнала событий"""
        try:
            # Структура для хранения событий
            events_data = {
                'overvoltage': {'A': [], 'B': [], 'C': []},  # перенапряжения
                'undervoltage': {'A': [], 'B': [], 'C': []}  # провалы
            }
            
            # Читаем файл как текст
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()
            
            # Начинаем с 3-й строки (индекс 2)
            for i, line in enumerate(lines[2:], start=3):
                try:
                    # Разбираем строку по табуляции
                    parts = line.strip().split('\t')
                    if len(parts) < 5:
                        continue
                    
                    # Колонки: A=время, B=событие, C=напряжение, D=глубина, E=продолжительность
                    datetime_str = parts[0]
                    event = parts[1]
                    voltage_str = parts[2].replace(',', '.')
                    duration_str = parts[4].replace(',', '.')
                    
                    # Парсим значения
                    try:
                        voltage = float(voltage_str)
                        duration = float(duration_str)
                    except:
                        continue
                    
                    # Критерий 1: продолжительность > 60
                    if duration <= 60:
                        continue
                    
                    # Критерий 2: напряжение != 11.50
                    if abs(voltage - 11.50) < 0.001:
                        continue
                    
                    # Определяем месяц из даты
                    try:
                        date_parts = datetime_str.split()[0].split('.')
                        month = int(date_parts[1])
                    except:
                        continue
                    
                    # Определяем тип события и фазу
                    phase = None
                    event_type = None
                    
                    if 'Фаза A' in event:
                        phase = 'A'
                    elif 'Фаза B' in event:
                        phase = 'B'
                    elif 'Фаза C' in event:
                        phase = 'C'
                    
                    if phase:
                        if 'провал окончание' in event:
                            event_type = 'undervoltage'
                        elif 'перенапряжение окончание' in event:
                            event_type = 'overvoltage'
                    
                    # Добавляем событие если определили тип и фазу
                    if phase and event_type:
                        events_data[event_type][phase].append({
                            'voltage': voltage,
                            'month': month,
                            'duration': duration
                        })
                    
                except Exception as e:
                    pass  # Пропускаем ошибочные строки
            
            # Формируем результат
            return self._generate_result(events_data)
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Ошибка анализа файла: {str(e)}",
                'has_errors': False
            }
    
    def _generate_result(self, events_data):
        """Генерация результата анализа"""
        summary_parts = []
        has_errors = False
        details = {
            'overvoltage': {},
            'undervoltage': {}
        }
        
        # Обработка перенапряжений
        for phase, events in events_data['overvoltage'].items():
            # Критерий 3: количество > 10
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                
                if min_month == max_month:
                    period = self.ru_months[min_month-1]
                else:
                    period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                
                max_voltage = max(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}>10% – {count} шт, Umax={max_voltage:.2f}"
                )
                
                details['overvoltage'][phase] = {
                    'count': count,
                    'max': max_voltage,
                    'period': period
                }
        
        # Обработка провалов
        for phase, events in events_data['undervoltage'].items():
            # Критерий 3: количество > 10
            if len(events) > 10:
                has_errors = True
                months = [e['month'] for e in events]
                min_month = min(months)
                max_month = max(months)
                
                if min_month == max_month:
                    period = self.ru_months[min_month-1]
                else:
                    period = f"{self.ru_months[min_month-1]}-{self.ru_months[max_month-1]}"
                
                min_voltage = min(e['voltage'] for e in events)
                count = len(events)
                
                summary_parts.append(
                    f"{period} U{phase.lower()}<10% – {count} шт, Umin={min_voltage:.2f}"
                )
                
                details['undervoltage'][phase] = {
                    'count': count,
                    'min': min_voltage,
                    'period': period
                }
        
        summary = '; '.join(summary_parts) if summary_parts else "Напряжение в пределах ГОСТ"
        
        return {
            'success': True,
            'summary': summary,
            'has_errors': has_errors,
            'details': details
        }

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
