#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from collections import defaultdict
import re

class RIMAnalyzer:
    def __init__(self):
        self.ru_months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 
                          'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
    
    def analyze_file(self, filepath):
        """Анализ файла журнала событий"""
        try:
            # Структура для хранения событий
            events_data = {
                'overvoltage': {'A': [], 'B': [], 'C': []},
                'undervoltage': {'A': [], 'B': [], 'C': []}
            }
            
            # Читаем файл
            with open(filepath, 'r', encoding='utf-8-sig') as f:
                content = f.read()
            
            # Разбиваем на строки
            lines = content.strip().split('\n')
            
            # Парсим каждую строку
            for line in lines:
                if not line.strip():
                    continue
                
                try:
                    # Используем регулярное выражение для парсинга
                    # Формат: дата время событие напряжение процент длительность
                    match = re.match(r'^(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2}:\d{2})\s+(.+?)\s+(\d+[,\.]\d+)\s+(\d+[,\.]\d+)\s+(\d+[,\.]\d+)$', line)
                    
                    if not match:
                        continue
                    
                    date_str = match.group(1)
                    time_str = match.group(2)
                    event = match.group(3)
                    voltage_str = match.group(4).replace(',', '.')
                    percent_str = match.group(5).replace(',', '.')
                    duration_str = match.group(6).replace(',', '.')
                    
                    # Парсим значения
                    voltage = float(voltage_str)
                    duration = float(duration_str)
                    
                    # Критерий 1: продолжительность > 60
                    if duration <= 60:
                        continue
                    
                    # Критерий 2: напряжение != 11.50
                    if abs(voltage - 11.50) < 0.001 or voltage == 0:
                        continue
                    
                    # Определяем месяц
                    month = int(date_str.split('.')[1])
                    
                    # Определяем тип события и фазу
                    phase = None
                    event_type = None
                    
                    # Проверяем фазу
                    if 'Фаза A' in event or 'фаза A' in event:
                        phase = 'A'
                    elif 'Фаза B' in event or 'фаза B' in event:
                        phase = 'B'
                    elif 'Фаза C' in event or 'фаза C' in event:
                        phase = 'C'
                    
                    if phase:
                        # Проверяем тип события
                        if 'провал окончание' in event or 'пропадание напряжения' in event:
                            event_type = 'undervoltage'
                        elif 'перенапряжение окончание' in event:
                            event_type = 'overvoltage'
                    
                    # Добавляем событие
                    if phase and event_type:
                        events_data[event_type][phase].append({
                            'voltage': voltage,
                            'month': month,
                            'duration': duration
                        })
                    
                except Exception as e:
                    continue
            
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
        
        # Если событий меньше 10, но есть события - для отладки
        if not has_errors:
            total_events = sum(len(events) for events in events_data['overvoltage'].values())
            total_events += sum(len(events) for events in events_data['undervoltage'].values())
            
            if total_events > 0:
                summary = f"Обнаружено событий: {total_events}, но все менее 10 по каждому типу"
            else:
                summary = "Напряжение в пределах ГОСТ"
        else:
            summary = '; '.join(summary_parts)
        
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
