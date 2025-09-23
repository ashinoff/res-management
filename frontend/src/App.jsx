// =====================================================
// УЛУЧШЕННЫЙ FRONTEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Файл: src/App.jsx
// Версия с исправленными фазами и загрузкой из АСКУЭ
// =====================================================

import React, { useState, useEffect, createContext, useContext, useCallback, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import * as XLSX from 'xlsx';

// =====================================================
// НАСТРОЙКА API КЛИЕНТА
// =====================================================

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 60000
});

// Добавляем токен к каждому запросу
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обработка ошибок авторизации
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// =====================================================
// КОНТЕКСТ АВТОРИЗАЦИИ
// =====================================================

const AuthContext = createContext(null);

// =====================================================
// КОМПОНЕНТ АВТОРИЗАЦИИ
// =====================================================

function LoginForm({ onLogin }) {
  const [credentials, setCredentials] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await api.post('/api/auth/login', credentials);
      localStorage.setItem('token', response.data.token);
      onLogin(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h2>Вход в систему контроля уровня напряжения</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Логин</label>
            <input
              type="text"
              value={credentials.login}
              onChange={(e) => setCredentials({...credentials, login: e.target.value})}
              required
            />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              required
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}

// =====================================================
// ГЛАВНОЕ МЕНЮ
// =====================================================

function MainMenu({ activeSection, onSectionChange, userRole }) {
  const [notificationCounts, setNotificationCounts] = useState({
    tech_pending: 0,
    askue_pending: 0,
    problem_vl: 0
  });

  // Загружаем количество уведомлений
  useEffect(() => {
    loadNotificationCounts();
    
    const interval = setInterval(loadNotificationCounts, 30000); // Обновляем каждые 30 сек
    
    // Слушаем события обновления
    const handleUpdate = () => loadNotificationCounts();
    window.addEventListener('notificationsUpdated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('notificationsUpdated', handleUpdate);
    };
  }, []);

  const loadNotificationCounts = async () => {
    try {
      const response = await api.get('/api/notifications/counts');
      setNotificationCounts(response.data);
    } catch (error) {
      console.error('Error loading notification counts:', error);
    }
  };

  const menuItems = [
    { id: 'structure', label: 'Структура сети', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'upload', label: 'Загрузить файлы', roles: ['admin', 'uploader'] },
    { id: 'tech_pending', label: 'Ожидающие мероприятий', roles: ['admin', 'res_responsible'], badge: notificationCounts.tech_pending },
    { id: 'askue_pending', label: 'Ожидающие проверки АСКУЭ', roles: ['admin', 'uploader'], badge: notificationCounts.askue_pending },
    { id: 'problem_vl', label: 'Проблемные ВЛ', roles: ['admin'], badge: notificationCounts.problem_vl },
    { id: 'documents', label: 'Загруженные документы', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'history', label: 'История системы', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'reports', label: 'Отчеты', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'settings', label: 'Настройки', roles: ['admin'] },
    { id: 'analytics', label: 'Аналитика', roles: ['admin', 'uploader', 'res_responsible'], }
  ];

  const visibleItems = menuItems.filter(item => item.roles.includes(userRole));

  return (
    <nav className="main-menu">
      <h3>Меню</h3>
      {visibleItems.map(item => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={`menu-item ${activeSection === item.id ? 'active' : ''}`}
        >
          <span className="menu-label">{item.label}</span>
          {item.badge > 0 && (
            <span className="notification-badge">{item.badge > 99 ? '99+' : item.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

// =====================================================
// КОМПОНЕНТ СТРУКТУРЫ СЕТИ
// =====================================================

function NetworkStructure() {
  const [networkData, setNetworkData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTp, setSearchTp] = useState('');
  const { user, selectedRes } = useContext(AuthContext);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [showExtendedModal, setShowExtendedModal] = useState(false);
  const [selectedPuData, setSelectedPuData] = useState(null);
  const [activeTab, setActiveTab] = useState('current'); // current, uploads, checks
  const [uploadHistory, setUploadHistory] = useState([]);
  const [checkHistory, setCheckHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [clearHistoryPassword, setClearHistoryPassword] = useState('');
  const [clearHistoryType, setClearHistoryType] = useState(''); // 'pu', 'tp', 'all'
  const [clearHistoryPu, setClearHistoryPu] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  
  // Для редактирования
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  
  // Для выбора и удаления
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  // Используем переданный selectedRes, если нет - берем из контекста
  
  
  // Оптимизированная функция загрузки
  const loadNetworkStructure = useCallback(async () => {
    try {
      const response = await api.get(`/api/network/structure/${selectedRes || ''}`);
      setNetworkData(response.data);
    } catch (error) {
      console.error('Error loading network structure:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRes]);

  useEffect(() => {
    loadNetworkStructure();
    
    // Слушаем события обновления
    const handleUpdate = () => loadNetworkStructure();
    
    window.addEventListener('structureUpdated', handleUpdate);
    window.addEventListener('dataCleared', handleUpdate);
    window.addEventListener('structureDeleted', handleUpdate);
    
    return () => {
      window.removeEventListener('structureUpdated', handleUpdate);
      window.removeEventListener('dataCleared', handleUpdate);
      window.removeEventListener('structureDeleted', handleUpdate);
    };
  }, [loadNetworkStructure]);

  useEffect(() => {
  const contentElement = document.querySelector('.content');
  
  const handleScroll = () => {
    if (contentElement) {
      setShowScrollTop(contentElement.scrollTop > 300);
    }
  };
  
  if (contentElement) {
    contentElement.addEventListener('scroll', handleScroll);
    return () => contentElement.removeEventListener('scroll', handleScroll);
  }
}, []);

  const getStatusColor = (status) => {
    switch(status) {
      case 'checked_ok': return 'status-ok';
      case 'checked_error': return 'status-error';
      case 'not_checked': return 'status-unchecked';
      case 'pending_recheck': return 'status-pending';
      case 'empty': return 'status-empty';
      default: return 'status-empty';
    }
  };

  const handleCellClick = (item, position) => {
  const puNumber = position === 'start' ? item.startPu : 
                   position === 'middle' ? item.middlePu : 
                   item.endPu;
  
  if (puNumber && item.PuStatuses) {
    const status = item.PuStatuses.find(s => 
      s.puNumber === puNumber && s.position === position
    );
    
    // НОВАЯ ЛОГИКА - открываем расширенное окно для всех
    setSelectedPuData({
      puNumber,
      position,
      tpName: item.tpName,
      vlName: item.vlName,
      resName: item.ResUnit?.name,
      status: status || { status: 'not_checked' },
      item
    });
    setShowExtendedModal(true);
    setActiveTab('current');
    loadPuHistory(puNumber);
  }
};
  
  // Функция загрузки истории
  const loadPuHistory = async (puNumber) => {
    setHistoryLoading(true);
    try {
      const [uploadsRes, checksRes] = await Promise.all([
        api.get(`/api/history/uploads/${puNumber}`),
        api.get(`/api/history/checks/${puNumber}`)
      ]);
      
      setUploadHistory(uploadsRes.data);
      setCheckHistory(checksRes.data);
    } catch (error) {
      console.error('Error loading PU history:', error);
    } finally {
      setHistoryLoading(false);
    }
  };

      
      
  
  // Начать редактирование
  const startEdit = (item, position) => {
    if (user.role !== 'admin') return;
    
    setEditingCell(`${item.id}-${position}`);
    const currentValue = position === 'start' ? item.startPu : 
                        position === 'middle' ? item.middlePu : 
                        item.endPu;
    setEditValue(currentValue || '');
  };
  
  // Сохранить изменения
  const saveEdit = async (item) => {
    try {
      const updateData = {
        startPu: item.startPu,
        middlePu: item.middlePu,
        endPu: item.endPu
      };
      
      const position = editingCell.split('-')[1];
      if (position === 'start') updateData.startPu = editValue || null;
      if (position === 'middle') updateData.middlePu = editValue || null;
      if (position === 'end') updateData.endPu = editValue || null;
      
      await api.put(`/api/network/structure/${item.id}`, updateData);
      
      await loadNetworkStructure();
      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      alert('Ошибка при сохранении');
    }
  };
  
  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };
  
  // Обработка выбора строк
  const handleSelectRow = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };
  
  const handleSelectAll = () => {
    if (selectedIds.length === filteredData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredData.map(item => item.id));
    }
  };
  
  // Удаление выбранных с автообновлением
  const handleDeleteSelected = async () => {
    try {
      const response = await api.post('/api/network/delete-selected', {
        ids: selectedIds,
        password: deletePassword
      });
    
      alert(response.data.message);
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedIds([]);
      setSearchTp(''); // Очищаем поле поиска!
    
      // Автообновление
      await loadNetworkStructure();
    
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

// Функция очистки истории ПУ
const handleClearPuHistory = async (puNumber) => {
  setClearHistoryPu(puNumber);
  setClearHistoryType('pu');
  setShowClearHistoryModal(true);
};

// Функция очистки истории по ТП
const handleClearTpHistory = async () => {
  if (selectedIds.length === 0) {
    alert('Выберите строки для очистки истории');
    return;
  }
  setClearHistoryType('tp');
  setShowClearHistoryModal(true);
};
  
// Функция выполнения очистки
const executeClearHistory = async () => {
  try {
    let response;
    
    if (clearHistoryType === 'pu') {
      response = await api.delete(`/api/history/clear-pu/${clearHistoryPu}`, {
        data: { password: clearHistoryPassword }
      });
    } else if (clearHistoryType === 'tp') {
  // Собираем уникальные ТП из выбранных строк
  const selectedTps = [...new Set(
    filteredData
      .filter(item => selectedIds.includes(item.id))
      .map(item => item.tpName)
  )];
  
  response = await api.post('/api/history/clear-tp', {
    password: clearHistoryPassword,
    tpNames: selectedTps,
    resId: selectedRes
  });
}
    
    alert(response.data.message);
    setShowClearHistoryModal(false);
    setClearHistoryPassword('');
    setSelectedIds([]);
    
    // Обновляем структуру
    await loadNetworkStructure();
    
  } catch (error) {
    alert('Ошибка: ' + (error.response?.data?.error || error.message));
  }
};

  
  const renderPuCell = (item, position) => {
    const puNumber = position === 'start' ? item.startPu : 
                     position === 'middle' ? item.middlePu : 
                     item.endPu;
    const isEditing = editingCell === `${item.id}-${position}`;
    
    if (isEditing) {
      return (
        <div className="edit-cell">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') saveEdit(item);
              if (e.key === 'Escape') cancelEdit();
            }}
            autoFocus
          />
          <button onClick={() => saveEdit(item)} className="save-btn">✓</button>
          <button onClick={cancelEdit} className="cancel-btn">✗</button>
        </div>
      );
    }
    
    return (
      <div 
        className="pu-cell"
        onDoubleClick={() => startEdit(item, position)}
        title={user.role === 'admin' ? 'Двойной клик для редактирования' : ''}
      >
        {puNumber ? (
          <>
            <div 
              className={`status-box ${getStatusColor(
                item.PuStatuses?.find(s => s.puNumber === puNumber && s.position === position)?.status || 'not_checked'
              )}`}
              onClick={() => handleCellClick(item, position)}
            />
            <span className="pu-number">{puNumber}</span>
          </>
        ) : (
          <div className="status-box status-empty">X</div>
        )}
      </div>
    );
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  
  const filteredData = networkData.filter(item => {
  // Фильтр по ТП
  if (searchTp && !item.tpName.toLowerCase().includes(searchTp.toLowerCase())) {
    return false;
  }
  
  // Фильтр по статусу
  if (statusFilter) {
    // Проверяем есть ли хотя бы один ПУ с нужным статусом
    const hasStatus = item.PuStatuses?.some(status => {
      if (statusFilter === 'empty') {
        // Проверяем пустые ячейки
        const hasStart = item.startPu;
        const hasMiddle = item.middlePu;
        const hasEnd = item.endPu;
        return !hasStart || !hasMiddle || !hasEnd;
      }
      return status.status === statusFilter;
    });
    
    // Также проверяем пустые ячейки если нет статусов
    if (!hasStatus && statusFilter === 'empty') {
      return !item.startPu || !item.middlePu || !item.endPu;
    }
    
    return hasStatus;
  }
  
  return true;
});
  const uniqueTps = [...new Set(filteredData.map(item => item.tpName))];
  
  // Функция экспорта в Excel
  const exportStructureToExcel = () => {
    if (filteredData.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }

    // Подготавливаем данные
    const exportData = filteredData.map(item => {
      // Находим статусы для каждого ПУ
      const getStatus = (puNumber, position) => {
        if (!puNumber) return 'Пусто';
        const status = item.PuStatuses?.find(s => s.puNumber === puNumber && s.position === position);
        
        switch(status?.status) {
          case 'checked_ok': return 'Проверен ✓';
          case 'checked_error': return 'Ошибка ✗';
          case 'pending_recheck': return 'Ожидает перепроверки';
          case 'not_checked': return 'Не проверен';
          default: return 'Не проверен';
        }
      };

      return {
        'РЭС': item.ResUnit?.name || '',
        'ТП': item.tpName || '',
        'ВЛ': item.vlName || '',
        'ПУ Начало': item.startPu || '-',
        'Статус начала': getStatus(item.startPu, 'start'),
        'ПУ Середина': item.middlePu || '-',
        'Статус середины': getStatus(item.middlePu, 'middle'),
        'ПУ Конец': item.endPu || '-',
        'Статус конца': getStatus(item.endPu, 'end'),
        'Последнее обновление': new Date(item.lastUpdate).toLocaleDateString('ru-RU')
      };
    });

    // Создаем Excel файл
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Устанавливаем ширину колонок
    ws['!cols'] = [
      { wch: 20 }, // РЭС
      { wch: 15 }, // ТП
      { wch: 15 }, // ВЛ
      { wch: 15 }, // ПУ Начало
      { wch: 20 }, // Статус начала
      { wch: 15 }, // ПУ Середина
      { wch: 20 }, // Статус середины
      { wch: 15 }, // ПУ Конец
      { wch: 20 }, // Статус конца
      { wch: 20 }  // Последнее обновление
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, '');
    
    const fileName = `Структура_сети_${selectedRes ? `РЭС_${selectedRes}_` : ''}${new Date().toLocaleDateString('ru-RU').split('.').join('-')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    alert(` экспортирована в файл: ${fileName}`);
  };
  
  return (
    <div className="network-structure">
      <h2></h2>
      {user.role === 'admin' && (
  <p className="edit-hint">
    <img src="/icons/important.png" alt="Важно" style={{width: 36, height: 36, verticalAlign: 'middle', marginRight: 5}} />
      Двойной клик по номеру счетчика для редактирования
  </p>
)}
      

<div className="structure-controls">
  <div className="search-box">
    <input 
      type="text"
      placeholder="Поиск по ТП..."
      value={searchTp}
      onChange={(e) => setSearchTp(e.target.value)}
      className="search-input"
    />
  </div>
  
  <div className="action-buttons-group">
    {user.role === 'admin' && selectedIds.length > 0 && (
      <button 
        className="delete-selected-btn"
        onClick={() => setShowDeleteModal(true)}
      >
        Удалить выбранные ({selectedIds.length})
      </button>
    )}
    
    <button 
      className="refresh-btn" 
       onClick={() => {
        setLoading(true);  // Показать загрузку
        loadNetworkStructure();
      }}
      disabled={loading}
    >
      {loading ? '⏳ Обновление...' : 'Обновить структуру'}
    </button>
    
    <button 
      className="export-btn" 
      onClick={exportStructureToExcel}
    >
      📊 Экспорт в Excel
    </button>
  </div>
</div>

     
      
      <div className="status-legend">
  <div 
    className={`legend-item ${statusFilter === 'checked_ok' ? 'active' : ''}`}
    onClick={() => setStatusFilter(statusFilter === 'checked_ok' ? null : 'checked_ok')}
  >
    <span className="status-box status-ok"></span> Проверен без отклонений
  </div>
  <div 
    className={`legend-item ${statusFilter === 'checked_error' ? 'active' : ''}`}
    onClick={() => setStatusFilter(statusFilter === 'checked_error' ? null : 'checked_error')}
  >
    <span className="status-box status-error"></span> Проверен с отклонениями
  </div>
  <div 
    className={`legend-item ${statusFilter === 'pending_recheck' ? 'active' : ''}`}
    onClick={() => setStatusFilter(statusFilter === 'pending_recheck' ? null : 'pending_recheck')}
  >
    <span className="status-box status-pending"></span> Ожидает проверки
  </div>
  <div className="legend-item disabled">
    <span className="status-box status-unchecked"></span> Не проверен
  </div>
  <div className="legend-item disabled">
    <span className="status-box status-empty">X</span> ПУ не задан
  </div>
</div>
      
      <div className="structure-table">
        <table>
          <thead>
            <tr>
              {user.role === 'admin' && (
                <th className="checkbox-column">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === filteredData.length && filteredData.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              <th>РЭС</th>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>Начало</th>
              <th>Середина</th>
              <th>Конец</th>
              <th>Дата обновления</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id} className={selectedIds.includes(item.id) ? 'selected' : ''}>
                {user.role === 'admin' && (
                  <td className="checkbox-column">
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => handleSelectRow(item.id)}
                    />
                  </td>
                )}
                <td>{item.ResUnit?.name}</td>
                <td>{item.tpName}</td>
                <td>{item.vlName}</td>
                <td>{renderPuCell(item, 'start')}</td>
                <td>{renderPuCell(item, 'middle')}</td>
                <td>{renderPuCell(item, 'end')}</td>
                <td>{new Date(item.lastUpdate).toLocaleDateString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <ErrorDetailsModal 
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        details={selectedDetails}
        tpName={selectedItem?.tpName}
        vlName={selectedItem?.vlName}
        position={selectedPosition}
      />

{showExtendedModal && selectedPuData && (
        <ExtendedPuModal
          isOpen={showExtendedModal}
          onClose={() => {
            setShowExtendedModal(false);
            setSelectedPuData(null);
            setUploadHistory([]);
            setCheckHistory([]);
          }}
          puData={selectedPuData}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          uploadHistory={uploadHistory}
          checkHistory={checkHistory}
          loading={historyLoading}
          handleClearPuHistory={handleClearPuHistory}
        />
      )}
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedIds.length} записей.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="new-password"    
                  name="delete-notification-password"  
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteSelected}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

{/* Модальное окно очистки истории */}
{showClearHistoryModal && (
  <div className="modal-backdrop" onClick={() => setShowClearHistoryModal(false)}>
    <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h3>Подтверждение очистки истории</h3>
        <button className="close-btn" onClick={() => setShowClearHistoryModal(false)}>✕</button>
      </div>
      <div className="modal-body">
        <p>
          {clearHistoryType === 'pu' && `Вы собираетесь очистить всю историю для ПУ ${clearHistoryPu}`}
          {clearHistoryType === 'tp' && `Вы собираетесь очистить историю для выбранных строк (${selectedIds.length} записей)`}
          {clearHistoryType === 'all' && 'Вы собираетесь очистить ВСЮ историю системы'}
        </p>
        <p className="warning">⚠️ Будут удалены все записи о загрузках и проверках!</p>
        <div className="form-group">
          <label>Введите пароль администратора:</label>
          <input
            type="password"
            value={clearHistoryPassword}
            onChange={(e) => setClearHistoryPassword(e.target.value)}
            placeholder="Пароль"
            autoFocus
          />
        </div>
      </div>
      <div className="modal-footer">
        <button className="cancel-btn" onClick={() => setShowClearHistoryModal(false)}>
          Отмена
        </button>
        <button 
          className="danger-btn" 
          onClick={executeClearHistory}
          disabled={!clearHistoryPassword}
        >
          Очистить историю
        </button>
      </div>
    </div>
  </div>
)}

{/* ДОБАВЬ КНОПКУ СЮДА: */}
      {showScrollTop && (
        <button 
    className="scroll-to-top"
    onClick={() => {
      const contentElement = document.querySelector('.content');
      if (contentElement) {
        contentElement.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }}
    title="Наверх"
  >
    ↑
  </button>
)}
      
    </div>
  );
}

// Модальное окно с деталями ошибки
function ErrorDetailsModal({ isOpen, onClose, details, tpName, vlName, position }) {
  if (!isOpen || !details) return null;
  
  // Парсим детали если они в формате JSON строки
  let errorSummary = '';
  let parsedDetails = null;
  
  try {
    if (details?.errorDetails) {
      const parsed = JSON.parse(details.errorDetails);
      errorSummary = parsed.summary || details.errorDetails;
      parsedDetails = parsed.details;
    }
  } catch (e) {
    errorSummary = details?.errorDetails || 'Нет данных';
  }
  
 
// Парсим фазы из деталей - красим ТОЛЬКО явно указанные!
const getPhaseErrors = () => {
  const phases = { A: false, B: false, C: false };
  
  if (parsedDetails) {
    // Проверяем только конкретные фазы
    if (parsedDetails.overvoltage) {
      if (parsedDetails.overvoltage.phase_A && parsedDetails.overvoltage.phase_A.count > 0) phases.A = true;
      if (parsedDetails.overvoltage.phase_B && parsedDetails.overvoltage.phase_B.count > 0) phases.B = true;
      if (parsedDetails.overvoltage.phase_C && parsedDetails.overvoltage.phase_C.count > 0) phases.C = true;
    }
    
    if (parsedDetails.undervoltage) {
      if (parsedDetails.undervoltage.phase_A && parsedDetails.undervoltage.phase_A.count > 0) phases.A = true;
      if (parsedDetails.undervoltage.phase_B && parsedDetails.undervoltage.phase_B.count > 0) phases.B = true;
      if (parsedDetails.undervoltage.phase_C && parsedDetails.undervoltage.phase_C.count > 0) phases.C = true;
    }
  }
  
  // Проверяем текст только на явные упоминания
  if (errorSummary) {
    if (errorSummary.indexOf('Фаза A') !== -1 || errorSummary.indexOf('phase_A') !== -1) phases.A = true;
    if (errorSummary.indexOf('Фаза B') !== -1 || errorSummary.indexOf('phase_B') !== -1) phases.B = true;
    if (errorSummary.indexOf('Фаза C') !== -1 || errorSummary.indexOf('phase_C') !== -1) phases.C = true;
  }
  
  return phases;
};
  
  const phaseErrors = getPhaseErrors();
  
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content error-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Детали проверки ПУ #{details?.puNumber}</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal-body">
          <div className="modal-info">
            <p><strong>ТП:</strong> {tpName}</p>
            <p><strong>Фидер:</strong> {vlName}</p>
            <p><strong>Позиция:</strong> {position === 'start' ? 'Начало' : position === 'middle' ? 'Середина' : 'Конец'}</p>
          </div>
          
          <div className="phase-indicators-large">
            <div className={`phase-indicator ${phaseErrors.A ? 'phase-error' : ''}`}>A</div>
            <div className={`phase-indicator ${phaseErrors.B ? 'phase-error' : ''}`}>B</div>
            <div className={`phase-indicator ${phaseErrors.C ? 'phase-error' : ''}`}>C</div>
          </div>
          
          <div className="error-summary">
            <h4>Обнаруженные отклонения:</h4>
            <div className="error-text">{errorSummary}</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="action-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}


// =====================================================
// КОМПОНЕНТ ЗАГРУЗКИ ФАЙЛОВ
// =====================================================

function FileUpload() {
  const [selectedType, setSelectedType] = useState('');
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const { user } = useContext(AuthContext);
  const [dragActive, setDragActive] = useState(false);

  const fileTypes = [
  { 
    id: 'rim_single', 
    label: 'Счетчики РИМ',
    icon: <img src="/icons/PU.png" alt="Счетчик" style={{width: 40, height: 40}} />,
    description: 'Один файл = один ПУ'
  },
  { 
    id: 'nartis', 
    label: 'Счетчики Нартис',
    icon: <img src="/icons/PU.png" alt="Счетчик" style={{width: 40, height: 40}} />,
    description: 'Один файл = один ПУ'
  },
  { 
    id: 'energomera', 
    label: 'Счетчики Энергомера',
    icon: <img src="/icons/PU.png" alt="Счетчик" style={{width: 40, height: 40}} />,
    description: 'Один файл = один ПУ'
  }
];

  const handleFileSelect = (e) => {
    setFiles(Array.from(e.target.files));
    setUploadResult(null);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFiles(Array.from(e.dataTransfer.files));
      setUploadResult(null);
    }
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
  if (!files.length || !selectedType) {
    alert('Выберите тип файла и файлы для загрузки');
    return;
  }
  
  // Определяем resId
  let resIdToUse;
  if (user.role === 'admin') {
    resIdToUse = user.resId || 1;
  } else {
    resIdToUse = user.resId;
  }
  
  if (!resIdToUse) {
    alert('Ошибка: не определен РЭС для загрузки');
    return;
  }
  
  setUploading(true);
  setUploadResult(null);
  setUploadProgress({ current: 0, total: files.length });
  
  const results = [];
  const errors = [];
  let duplicatesCount = 0;
  let successCount = 0;
  let problemsCount = 0;
  let wrongPeriodCount = 0;
  
  // Обрабатываем каждый файл
for (let i = 0; i < files.length; i++) {
  const file = files[i];
  setUploadProgress({ current: i + 1, total: files.length });
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', selectedType);
  formData.append('resId', resIdToUse);
  
  try {
    const response = await api.post('/api/upload/analyze', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    
    // Проверка на разные статусы
    const firstDetail = response.data.details?.[0];
    
    if (firstDetail) {
      if (firstDetail.status === 'duplicate_error') {
        duplicatesCount++;
        results.push({
          fileName: file.name,
          status: 'duplicate',
          message: firstDetail.error
        });
      } else if (firstDetail.status === 'wrong_period') {
        wrongPeriodCount++;
        results.push({
          fileName: file.name,
          status: 'wrong_period',
          message: firstDetail.error
        });
      } else if (firstDetail.status === 'not_in_structure') {
        results.push({
          fileName: file.name,
          status: 'not_found',
          message: 'ПУ не найден в структуре сети'
        });
      } else {
        // Обычная обработка
        if (response.data.errors > 0) {
          problemsCount += response.data.errors;
        } else {
          successCount++;
        }
        
        results.push({
          fileName: file.name,
          status: 'processed',
          ...response.data
        });
      }
    }
    
  } catch (error) {
    errors.push({
      fileName: file.name,
      error: error.response?.data?.error || 'Ошибка загрузки'
    });
  }
}
  
  // Показываем итоговый результат
  setUploadResult({
    success: errors.length === 0,
    totalFiles: files.length,
    successCount,
    problemsCount,
    duplicatesCount,
    wrongPeriodCount,
    errorCount: errors.length,
    results,
    errors
  });
  
  // Формируем итоговое сообщение
  let message = `Обработано файлов: ${files.length}\n`;
  if (successCount > 0) message += `✅ Отклонений по напряжению не найдено: ${successCount}\n`;
  if (problemsCount > 0) message += `⚠️ Отклонения по напряжению найдены: ${problemsCount}\n`;
  if (duplicatesCount > 0) message += `🔄 Загружен ранее использованный файл: ${duplicatesCount}\n`;
  if (wrongPeriodCount > 0) message += `📅 Неверный период загруженного файла: ${wrongPeriodCount}\n`;
  if (errors.length > 0) message += `❌ Ошибок загрузки: ${errors.length}`;
  
  alert(message);
  
  // Сбрасываем форму
  setFiles([]);
  setSelectedType('');
  setUploading(false);
  
  // Создаем событие для обновления структуры
  window.dispatchEvent(new CustomEvent('structureUpdated'));
  window.dispatchEvent(new CustomEvent('notificationsUpdated'));
};

  return (
    <div className="file-upload-container">
      <div className="upload-header">
        <h2>Загрузка файлов для анализа</h2>
        <p className="upload-subtitle">Загружайте Excel файлы с данными счетчиков для автоматической проверки</p>
      </div>

      {/* Информационная панель */}
      <div className="upload-info-panel">
        <div className="info-card">
  <div className="info-icon">
    <img src="/icons/place.png" alt="Местоположение" style={{width: 72, height: 72}} />
  </div>
  <div className="info-content">
    <h4>Текущий РЭС</h4>
    <p>{user.resName || 'Ваш РЭС'}</p>
  </div>
</div>
        <div className="info-card">
  <div className="info-icon">
    <img src="/icons/important.png" alt="Важно" style={{width: 60, height: 60}} />
  </div>
  <div className="info-content">
    <h4>ВАЖНО!!!</h4>
    <p>Имя файла должно совпадать с номером ПУ</p>
  </div>
</div>
      </div>

      {/* Выбор типа файла */}
      <div className="file-type-selection">
        <h3>1. Выберите тип счетчика</h3>
        <div className="file-types-grid">
          {fileTypes.map(type => (
            <div 
              key={type.id}
              className={`file-type-card ${selectedType === type.id ? 'selected' : ''}`}
              onClick={() => setSelectedType(type.id)}
            >
              <div className="type-icon">{type.icon}</div>
              <div className="type-info">
                <h4>{type.label}</h4>
                <p>{type.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Зона загрузки файлов */}
      {selectedType && (
        <div className="file-drop-section">
          <h3>2. Загрузите файлы</h3>
          <div 
            className={`drop-zone ${dragActive ? 'drag-active' : ''} ${files.length > 0 ? 'has-files' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              id="file-input"
              accept=".xlsx,.xls,.csv"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            
            {files.length === 0 ? (
              <>
                <div className="drop-icon">📁</div>
                <h4>Перетащите файлы сюда</h4>
                <p>или</p>
                <label htmlFor="file-input" className="btn btn-primary">
                  Выберите файлы
                </label>
                <p className="drop-hint">Поддерживаются форматы: .xlsx, .xls, .csv</p>
              </>
            ) : (
              <div className="files-list">
                <h4>Выбрано файлов: {files.length}</h4>
                <div className="files-grid">
                  {files.map((file, idx) => (
                    <div key={idx} className="file-item-card">
                      <div className="file-icon">📄</div>
                      <div className="file-details">
                        <p className="file-name">{file.name}</p>
                        <p className="file-size">{(file.size / 1024).toFixed(1)} KB</p>
                        <p className="pu-number">ПУ: {file.name.split('.')[0]}</p>
                      </div>
                      <button 
                        className="remove-file-btn"
                        onClick={() => removeFile(idx)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <label htmlFor="file-input" className="btn btn-secondary">
                  Добавить еще файлы
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Прогресс загрузки */}
      {uploading && (
        <div className="upload-progress-section">
          <div className="progress-header">
            <h4>Загрузка и анализ файлов</h4>
            <span>{uploadProgress.current} из {uploadProgress.total}</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Кнопка загрузки */}
      {files.length > 0 && !uploading && (
        <div className="upload-actions">
          <button 
            onClick={handleUpload} 
            disabled={!selectedType}
            className="btn btn-primary btn-large"
          >
            <span>🚀</span>
            Загрузить и анализировать ({files.length} файлов)
          </button>
        </div>
      )}

      {/* Результаты остаются как были */}
      {uploadResult && (
        <div className={`upload-result ${uploadResult.success ? 'success' : 'error'}`}>
          {/* ... существующий код результатов ... */}
        </div>
      )}
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ УВЕДОМЛЕНИЙ (ИСПРАВЛЕННЫЙ!)
// =====================================================

function Notifications({ filterType, onSectionChange, selectedRes }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [comment, setComment] = useState('');
  const [checkFromDate, setCheckFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');
  const { user } = useContext(AuthContext);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteNotificationId, setDeleteNotificationId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsNotification, setDetailsNotification] = useState(null);
  const [uploadingPu, setUploadingPu] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]); // ДОБАВЛЕНО!
  const [submitting, setSubmitting] = useState(false);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  
 // Оптимизированная функция загрузки
const loadNotifications = useCallback(async () => {
  try {
    const params = selectedRes ? `?resId=${selectedRes}` : '';
    const response = await api.get(`/api/notifications${params}`);
    // Фильтруем по переданному типу
    const filtered = response.data.filter(n => {
      if (filterType) return n.type === filterType;
      return true;
    });
    setNotifications(filtered);
  } catch (error) {
    console.error('Error loading notifications:', error);
  } finally {
    setLoading(false);
  }
}, [filterType, selectedRes]);

  useEffect(() => {
    loadNotifications();
     markAsRead();
    
    // Слушаем события обновления
    const handleUpdate = () => loadNotifications();
    
    window.addEventListener('structureUpdated', handleUpdate);
    window.addEventListener('notificationsUpdated', handleUpdate);
    window.addEventListener('dataCleared', handleUpdate);
    
    // Автообновление каждые 30 секунд
    const interval = setInterval(loadNotifications, 30000);
    
    return () => {
      window.removeEventListener('structureUpdated', handleUpdate);
      window.removeEventListener('notificationsUpdated', handleUpdate);
      window.removeEventListener('dataCleared', handleUpdate);
      clearInterval(interval);
    };
  }, [loadNotifications]);

  useEffect(() => {
    const contentElement = document.querySelector('.content');
    
    const handleScroll = () => {
      if (contentElement) {
        setShowScrollTop(contentElement.scrollTop > 300);
      }
    };
    
    if (contentElement) {
      contentElement.addEventListener('scroll', handleScroll);
      return () => contentElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const markAsRead = async () => {
  try {
    // Отмечаем уведомления как прочитанные при открытии
    await api.put('/api/notifications/mark-read', { 
      type: filterType === 'error' ? 'error' : 
            filterType === 'pending_askue' ? 'pending_askue' : 
            'all'
    });
    
    // Обновляем счетчики
    window.dispatchEvent(new CustomEvent('notificationsUpdated'));
  } catch (error) {
    console.error('Error marking as read:', error);
  }
};

  const handleCompleteWork = async () => {
    const wordCount = comment.trim().split(' ').filter(word => word.length > 0).length;
    if (wordCount < 5) {
      alert('Комментарий должен содержать не менее 5 слов');
      return;
    }

     setSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append('comment', comment);
      formData.append('checkFromDate', checkFromDate);
      
      // Добавляем файлы
      attachedFiles.forEach(file => {
        formData.append('attachments', file);
      });
      
      await api.post(`/api/notifications/${selectedNotification.id}/complete-work`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Закрываем модальное окно сразу
    setShowCompleteModal(false);
    setComment('');
    setAttachedFiles([]);
    setSelectedNotification(null);

      
      alert('Мероприятия отмечены как выполненные');
      setShowCompleteModal(false);
      setComment('');
      setAttachedFiles([]);
      setSelectedNotification(null);
      
      await loadNotifications();
      
    } catch (error) {
      alert('Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
    setSubmitting(false); // ДОБАВИТЬ - разблокируем кнопку в любом случае
  }
};

  const handleDeleteNotification = async () => {
    try {
      await api.delete(`/api/notifications/${deleteNotificationId}`, {
        data: { password: deletePassword }
      });
     
      alert('Уведомление удалено');
      setShowDeleteModal(false);
      setDeletePassword('');
      setDeleteNotificationId(null);
      
      // ВАЖНО: Автообновление после удаления!
      await loadNotifications();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSelectNotification = (id) => {
    setSelectedNotificationIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedNotificationIds.length === filteredNotifications.length) {
      setSelectedNotificationIds([]);
    } else {
      setSelectedNotificationIds(filteredNotifications.map(n => n.id));
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.post('/api/notifications/delete-bulk', {
        ids: selectedNotificationIds,
        password: bulkDeletePassword
      });
      
      alert(`Удалено уведомлений: ${selectedNotificationIds.length}`);
      setShowBulkDeleteModal(false);
      setBulkDeletePassword('');
      setSelectedNotificationIds([]);
      setSearchTp('');
      await loadNotifications();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  // Функция загрузки файла прямо из уведомления АСКУЭ
  const handleFileUpload = async (puNumber, notificationData) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Проверяем имя файла
    const fileName = file.name.split('.')[0];
    if (fileName !== puNumber) {
      alert(`Имя файла должно быть ${puNumber}.xls или ${puNumber}.xlsx`);
      return;
    }
    
    setUploadingPu(puNumber);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'rim_single');
    formData.append('resId', user.resId);
    formData.append('requiredPeriod', notificationData.checkFromDate);
    
    try {
      const response = await api.post('/api/upload/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // ПРОВЕРЯЕМ РЕЗУЛЬТАТ!
      if (response.data.details && response.data.details.length > 0) {
        const firstResult = response.data.details[0];
        
        // Проверяем статус
        if (firstResult.status === 'wrong_period') {
          // Показываем ошибку периода
          alert(firstResult.error);
          // НЕ обновляем уведомления, чтобы можно было попробовать снова
          return;
        } else if (firstResult.status === 'duplicate_error') {
          // Показываем ошибку дубликата
          alert(firstResult.error);
          return;
        }
      }
      
      // Если все ок
      alert('Файл успешно загружен и обработан!');
      await loadNotifications();
      window.dispatchEvent(new CustomEvent('structureUpdated'));
      
    } catch (error) {
      alert('Ошибка загрузки: ' + (error.response?.data?.error || error.message));
    } finally {
      setUploadingPu(null);
    }
  };
  
  input.click();
};

  // ИСПРАВЛЕННАЯ функция определения фаз - без регулярных выражений!
  const getPhaseErrors = useCallback((errorDetails) => {
    const phases = { A: false, B: false, C: false };
    
    if (!errorDetails) return phases;
    
    try {
      let data = null;
      let textToAnalyze = '';
      
      // Пытаемся распарсить JSON
      if (typeof errorDetails === 'string') {
        try {
          const parsed = JSON.parse(errorDetails);
          data = parsed.details || parsed;
          textToAnalyze = parsed.summary || errorDetails;
        } catch {
          textToAnalyze = errorDetails;
        }
      } else if (typeof errorDetails === 'object') {
        data = errorDetails.details || errorDetails;
        textToAnalyze = errorDetails.summary || JSON.stringify(errorDetails);
      }
      
      // Проверяем структурированные данные ТОЛЬКО если есть конкретные фазы
      if (data && typeof data === 'object') {
        if (data.overvoltage) {
          if (data.overvoltage.phase_A && data.overvoltage.phase_A.count > 0) phases.A = true;
          if (data.overvoltage.phase_B && data.overvoltage.phase_B.count > 0) phases.B = true;
          if (data.overvoltage.phase_C && data.overvoltage.phase_C.count > 0) phases.C = true;
        }
        
        if (data.undervoltage) {
          if (data.undervoltage.phase_A && data.undervoltage.phase_A.count > 0) phases.A = true;
          if (data.undervoltage.phase_B && data.undervoltage.phase_B.count > 0) phases.B = true;
          if (data.undervoltage.phase_C && data.undervoltage.phase_C.count > 0) phases.C = true;
        }
      }
      
      // Проверяем текст ТОЛЬКО на явные упоминания конкретных фаз
      if (textToAnalyze) {
        // Только если явно написано "Фаза A" или "phase_A"
        if (textToAnalyze.indexOf('Фаза A') !== -1 || textToAnalyze.indexOf('phase_A') !== -1) phases.A = true;
        if (textToAnalyze.indexOf('Фаза B') !== -1 || textToAnalyze.indexOf('phase_B') !== -1) phases.B = true;
        if (textToAnalyze.indexOf('Фаза C') !== -1 || textToAnalyze.indexOf('phase_C') !== -1) phases.C = true;
      }
    } catch (e) {
      console.error('Error parsing phase errors:', e);
    }
    
    return phases;
  }, []);

  if (loading) return <div className="loading">Загрузка...</div>;

  const title = filterType === 'error' ? 'Ожидающие мероприятий' : 
                filterType === 'pending_askue' ? 'Ожидающие проверки АСКУЭ' : 
                'Все уведомления';

  // Фильтрация по ТП
  const filteredNotifications = notifications.filter(notif => {
    if (!searchTp) return true;
    try {
      const data = JSON.parse(notif.message);
      return data.tpName?.toLowerCase().includes(searchTp.toLowerCase());
    } catch {
      return true;
    }
  });

  return (
    <div className="notifications">
  <h2>{title}</h2>
  
  <div className="notifications-controls">
    <div className="search-box">
      <input
        type="text"
        placeholder="Поиск по ТП..."
        value={searchTp}
        onChange={(e) => setSearchTp(e.target.value)}
        className="search-input"
        autoComplete="new-password"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        name={`search-tp-${Date.now()}`}  // Динамическое имя
        id={`search-tp-${Date.now()}`}
      />
    </div>
    
    {user.role === 'admin' && selectedNotificationIds.length > 0 && (
      <button 
        className="delete-selected-btn"
        onClick={() => setShowBulkDeleteModal(true)}
      >
        Удалить выбранные ({selectedNotificationIds.length})
      </button>
    )}
  </div>
  
  {user.role === 'admin' && (
    <div className="select-all-wrapper">
      <input 
        type="checkbox"
        checked={selectedNotificationIds.length === filteredNotifications.length && filteredNotifications.length > 0}
        onChange={handleSelectAll}
      />
      <span>Выбрать все</span>
    </div>
  )}
      
      <div className="notifications-list">
  {filteredNotifications.map(notif => (
    <div 
      key={notif.id} 
      className={`notification-compact ${notif.type} ${!notif.isRead ? 'unread' : ''} ${selectedNotificationIds.includes(notif.id) ? 'selected' : ''}`}
    >
      {/* ЧЕКБОКС ТЕПЕРЬ СНАРУЖИ И СЛЕВА */}
      {user.role === 'admin' && (
        <input 
          type="checkbox"
          className="notification-checkbox-left"
          checked={selectedNotificationIds.includes(notif.id)}
          onChange={() => handleSelectNotification(notif.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      
      {/* КОМПАКТНЫЕ УВЕДОМЛЕНИЯ ОБ ОШИБКАХ */}
      {notif.type === 'error' && (() => {
        try {
          const data = JSON.parse(notif.message);
          const phaseErrors = getPhaseErrors(data.details || data.errorDetails);
          
          return (
            <div className="notification-narrow-content">
              {/* УБИРАЕМ ЧЕКБОКС ОТСЮДА */}
              
              <div className="notification-phases">
                <div className={`phase-indicator ${phaseErrors.A ? 'phase-error' : ''}`}>A</div>
                <div className={`phase-indicator ${phaseErrors.B ? 'phase-error' : ''}`}>B</div>
                <div className={`phase-indicator ${phaseErrors.C ? 'phase-error' : ''}`}>C</div>
              </div>
              
              <div className="notification-narrow-info">
                <div className="notification-tp">{data.tpName}</div>
                <div className="notification-narrow-details">
                  <span className="label">РЭС:</span> {data.resName} | 
                  <span className="label"> ТП:</span> {data.tpName} | 
                  <span className="label"> ВЛ:</span> {data.vlName} | 
                  <span className="label"> Позиция:</span> {
                    data.position === 'start' ? 'Начало' : 
                    data.position === 'middle' ? 'Середина' : 'Конец'
                  }
                </div>
                <div className="notification-pu-number">
                  ПУ №: <strong>{data.puNumber}</strong>
                </div>
              </div>
              
              <div className="notification-narrow-actions">
                <button 
                  className="btn-details-blue"
                  onClick={() => {
                    setDetailsNotification({ ...notif, data });
                    setShowDetailsModal(true);
                  }}
                >
                  Детали
                </button>
                
                {user.role === 'res_responsible' && (
                  <button 
                    className="btn-complete-green"
                    onClick={() => {
                      setSelectedNotification({ id: notif.id, data });
                      setShowCompleteModal(true);
                    }}
                    title="Выполнить мероприятия"
                  >
                    Завершить
                  </button>
                )}
                
                {/* УБИРАЕМ КНОПКУ УДАЛЕНИЯ */}
              </div>
            </div>
          );
        } catch (e) {
          return <div className="error-text">Ошибка отображения</div>;
        }
      })()}
      
      {/* КОМПАКТНЫЕ УВЕДОМЛЕНИЯ АСКУЭ */}
      {notif.type === 'pending_askue' && (() => {
        try {
          const data = JSON.parse(notif.message);
          return (
            <div className="notification-compact-content askue">
              {/* УБИРАЕМ ЧЕКБОКС ОТСЮДА */}
              
              <div className="notification-main-info">
                <div className="notification-location">
                  <span className="label">ТП:</span> {data.tpName} | 
                  <span className="label"> ПУ №:</span> <strong>{data.puNumber}</strong> | 
                  <span className="label"> Журнал с:</span> <strong>{new Date(data.checkFromDate).toLocaleDateString('ru-RU')}</strong>
                </div>
              </div>
              
              <div className="notification-actions-row">
                <div className="notification-buttons">
                  <button 
                    className="btn-upload-orange"  // Изменили класс
                    onClick={() => handleFileUpload(data.puNumber, data)}
                    disabled={uploadingPu === data.puNumber}
                    title="Загрузить файл"
                  >
                    {uploadingPu === data.puNumber ? 'Загрузка...' : 'Загрузить'}
                  </button>
                  
                  <button 
                    className="btn-details-blue"
                    onClick={() => {
                      setDetailsNotification({ ...notif, data });
                      setShowDetailsModal(true);
                    }}
                  >
                    Детали
                  </button>
                  
                  {/* УБИРАЕМ КНОПКУ УДАЛЕНИЯ */}
                </div>
              </div>
            </div>
          );
        } catch (e) {
          return <div className="error-text">Ошибка отображения</div>;
        }
      })()}

      {/* УВЕДОМЛЕНИЯ О ПРОБЛЕМНЫХ ВЛ */}
      {notif.type === 'problem_vl' && (() => {
        try {
          const data = JSON.parse(notif.message);
          return (
            <div className="notification-compact-content problem-vl">
              {/* УБИРАЕМ ЧЕКБОКС ОТСЮДА */}
              
              <div className="problem-vl-alert">
                <span className="critical-icon">🚨</span>
                <div className="problem-vl-header">
                  <h4>Критическая проблема!</h4>
                  <span className="failure-count">{data.failureCount} неудачных проверок</span>
                </div>
              </div>
              
              <div className="notification-main-info">
                <div className="notification-location">
                  <span className="label">РЭС:</span> {data.resName} | 
                  <span className="label"> ТП:</span> {data.tpName} | 
                  <span className="label"> ВЛ:</span> {data.vlName}
                </div>
                <div className="notification-pu">
                  <span className="label">ПУ №:</span> <strong>{data.puNumber}</strong> | 
                  <span className="label"> Позиция:</span> {
                    data.position === 'start' ? 'Начало' :
                    data.position === 'middle' ? 'Середина' : 'Конец'
                  }
                </div>
              </div>
              
              <div className="problem-error-details">
                <p className="error-label">Последняя ошибка:</p>
                <p className="error-text">{data.errorDetails}</p>
              </div>
              
              {data.resComment && (
                <div className="problem-res-comment">
                  <p className="comment-label">Комментарий РЭС:</p>
                  <p className="comment-text">{data.resComment}</p>
                </div>
              )}
              
              <div className="notification-actions-row">
                <div className="notification-buttons">
                  <button 
                    className="btn-view-problem"
                    onClick={() => {
                      if (typeof onSectionChange === 'function') {
                        onSectionChange('problem_vl');
                      }
                    }}
                    title="Перейти к проблемным ВЛ"
                  >
                    📊 К проблемным ВЛ
                  </button>
                  
                  {/* УБИРАЕМ КНОПКУ УДАЛЕНИЯ */}
                </div>
              </div>
            </div>
          );
        } catch (e) {
          console.error('Error parsing problem VL notification:', e);
          return <div className="error-text">Ошибка отображения уведомления</div>;
        }
      })()}
            
            {/* УСПЕШНЫЕ УВЕДОМЛЕНИЯ */}
            {notif.type === 'success' && (
              <div className="notification-compact-content success">
                <div className="success-icon">✅</div>
                <div className="success-text">{notif.message}</div>
              </div>
            )}

            {/* ИНФОРМАЦИОННЫЕ УВЕДОМЛЕНИЯ */}
            {notif.type === 'info' && (
              <div className="notification-compact-content info">
                <div className="info-icon">ℹ️</div>
                <div className="info-text">{notif.message}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Модальное окно деталей */}
      {showDetailsModal && detailsNotification && (
        <div className="modal-backdrop" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подробная информация</h3>
              <button className="close-btn" onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              {detailsNotification.type === 'error' && (
                <>
                  {/* Показываем фазы в детальном окне */}
                  <div className="phase-indicators-large">
                    {(() => {
                      const phases = { A: false, B: false, C: false };
                      
                      // Проверяем только явные упоминания фаз
                      if (detailsNotification.data.details && typeof detailsNotification.data.details === 'object') {
                        const details = detailsNotification.data.details;
                        if (details.overvoltage) {
                          if (details.overvoltage.phase_A && details.overvoltage.phase_A.count > 0) phases.A = true;
                          if (details.overvoltage.phase_B && details.overvoltage.phase_B.count > 0) phases.B = true;
                          if (details.overvoltage.phase_C && details.overvoltage.phase_C.count > 0) phases.C = true;
                        }
                        if (details.undervoltage) {
                          if (details.undervoltage.phase_A && details.undervoltage.phase_A.count > 0) phases.A = true;
                          if (details.undervoltage.phase_B && details.undervoltage.phase_B.count > 0) phases.B = true;
                          if (details.undervoltage.phase_C && details.undervoltage.phase_C.count > 0) phases.C = true;
                        }
                      }
                      
                      const errorText = detailsNotification.data.errorDetails || '';
                      if (errorText.indexOf('Фаза A') !== -1 || errorText.indexOf('phase_A') !== -1) phases.A = true;
                      if (errorText.indexOf('Фаза B') !== -1 || errorText.indexOf('phase_B') !== -1) phases.B = true;
                      if (errorText.indexOf('Фаза C') !== -1 || errorText.indexOf('phase_C') !== -1) phases.C = true;
                      
                      return (
                        <>
                          <div className={`phase-indicator ${phases.A ? 'phase-error' : ''}`}>A</div>
                          <div className={`phase-indicator ${phases.B ? 'phase-error' : ''}`}>B</div>
                          <div className={`phase-indicator ${phases.C ? 'phase-error' : ''}`}>C</div>
                        </>
                      );
                    })()}
                  </div>
                  
                  <div className="detail-row">
                    <strong>РЭС:</strong> {detailsNotification.data.resName}
                  </div>
                  <div className="detail-row">
                    <strong>ТП:</strong> {detailsNotification.data.tpName}
                  </div>
                  <div className="detail-row">
                    <strong>Фидер:</strong> {detailsNotification.data.vlName}
                  </div>
                  <div className="detail-row">
                    <strong>ПУ №:</strong> {detailsNotification.data.puNumber}
                  </div>
                  <div className="detail-row">
                    <strong>Позиция:</strong> {
                      detailsNotification.data.position === 'start' ? 'Начало' :
                      detailsNotification.data.position === 'middle' ? 'Середина' : 'Конец'
                    }
                  </div>
                  <div className="error-details-box">
                    <strong>Детали ошибки:</strong>
                    <p>{detailsNotification.data.errorDetails}</p>
                  </div>
                </>
              )}
              
              {detailsNotification.type === 'pending_askue' && (
                <>
                  <div className="askue-details-content">
                    <h4>⚡ Требуется снять журнал событий</h4>
                    <div className="detail-row">
                      <strong>ПУ №:</strong> {detailsNotification.data.puNumber}
                    </div>
                    <div className="detail-row">
                      <strong>ТП:</strong> {detailsNotification.data.tpName}
                    </div>
                    <div className="detail-row">
                      <strong>Фидер:</strong> {detailsNotification.data.vlName}
                    </div>
                    <div className="highlight-box">
                      <strong>📅 Журнал событий с даты:</strong>
                      <p>{new Date(detailsNotification.data.checkFromDate).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div className="highlight-box">
                      <strong>💬 Комментарий РЭС:</strong>
                      <p>{detailsNotification.data.completedComment}</p>
                    </div>
                    <div className="detail-row">
                      <strong>Мероприятия выполнены:</strong> {new Date(detailsNotification.data.completedAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="action-btn" onClick={() => setShowDetailsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно для выполнения мероприятий */}
      {showCompleteModal && selectedNotification && (
        <div className="modal-backdrop" onClick={() => setShowCompleteModal(false)}>
          <div className="modal-content complete-work-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Отметить выполнение мероприятий</h3>
              <button className="close-btn" onClick={() => setShowCompleteModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="work-info">
                <p><strong>ТП:</strong> {selectedNotification.data.tpName}</p>
                <p><strong>ВЛ:</strong> {selectedNotification.data.vlName}</p>
                <p><strong>ПУ №:</strong> {selectedNotification.data.puNumber}</p>
              </div>
              
              <div className="form-group">
                <label>Что было выполнено? (минимум 5 слов)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Опишите выполненные работы..."
                  rows={4}
                />
                <small className="word-count">
                  Слов: {comment.trim().split(' ').filter(w => w.length > 0).length} из 5
                </small>
              </div>
              
              <div className="form-group">
                <label>Журнал событий требуется с даты:</label>
                <input
                  type="date"
                  value={checkFromDate}
                  onChange={(e) => setCheckFromDate(e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label>Прикрепить фото/документы (макс. 5 файлов по 10MB)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const files = Array.from(e.target.files).slice(0, 5);
                    setAttachedFiles(files);
                  }}
                />
                {attachedFiles.length > 0 && (
                  <div className="attached-files-list">
                    <p>Выбрано файлов: {attachedFiles.length}</p>
                    {attachedFiles.map((file, idx) => (
                      <div key={idx} className="attached-file-item">
                        {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCompleteModal(false)}>
                Отмена
                </button>
              <button 
                className="confirm-btn" 
                onClick={handleCompleteWork}
                  disabled={
                  comment.trim().split(' ').filter(w => w.length > 0).length < 5 ||
                  submitting
                }
              >
                {submitting ? 'Отправка...' : 'Подтвердить выполнение'}
                </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить это уведомление.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="new-password"    
                  name="delete-notification-password"  
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteNotification}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ДОБАВЬТЕ ЭТО МОДАЛЬНОЕ ОКНО: */}
      {showBulkDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowBulkDeleteModal(false); setBulkDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowBulkDeleteModal(false); setBulkDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedNotificationIds.length} уведомлений.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={bulkDeletePassword}
                  onChange={(e) => setBulkDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="new-password"  // Добавить
                  name={`delete-password-${Date.now()}`}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowBulkDeleteModal(false); setBulkDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleBulkDelete}
                disabled={!bulkDeletePassword}
              >
                Удалить выбранные
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ДОБАВЬТЕ КНОПКУ ПРОКРУТКИ: */}
      {showScrollTop && (
        <button 
          className="scroll-to-top"
          onClick={() => {
            const contentElement = document.querySelector('.content');
            if (contentElement) {
              contentElement.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="Наверх"
        >
          ↑
        </button>
      )}
    </div>
  );
}

    

// =====================================================
// КОМПОНЕНТ ОТЧЕТОВ
// =====================================================

function Reports() {
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [selectedComment, setSelectedComment] = useState(null);
  const { user, selectedRes } = useContext(AuthContext);

  const [reportType, setReportType] = useState('pending_work');
  const [reportData, setReportData] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');
  
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  useEffect(() => {
    loadReports();
  }, [reportType, dateFrom, dateTo, selectedRes]);

  const loadReports = async () => {
  setLoading(true);
  try {
    let response;
    
    if (reportType === 'problem_vl') {
      response = await api.get('/api/reports/problem-vl', {
        params: { 
          dateFrom, 
          dateTo,
          resId: user.role === 'admin' ? selectedRes : user.resId // Используем selectedRes для админа
        }
      });
    } else {
      response = await api.get('/api/reports/detailed', {
        params: {
          type: reportType,
          dateFrom,
          dateTo,
          resId: user.role === 'admin' ? selectedRes : user.resId // Используем selectedRes для админа
        }
      });
    }
    
    setReportData(response.data);
  } catch (error) {
    console.error('Error loading reports:', error);
    setReportData([]);
  } finally {
    setLoading(false);
  }
};
  
  // Функция для открытия просмотра файлов
  const viewAttachments = (attachments) => {
    
    console.log('Viewing attachments:', attachments);
    
    if (attachments && attachments.length > 0) {
      setSelectedFiles(attachments);
      setCurrentFileIndex(0);
      setShowFileViewer(true);
    }
  };
  
  // Обновленная функция exportToExcel в компоненте Reports
  const exportToExcel = () => {
  if (filteredData.length === 0) {
    alert('Нет данных для экспорта');
    return;
  }

  // Подготавливаем данные для экспорта
  const exportData = filteredData.map(item => {
    const base = {
      'РЭС': item.resName || '',
      'ТП': item.tpName || '',
      'ВЛ': item.vlName || '',
      'Позиция': item.position === 'start' ? 'Начало' : 
                 item.position === 'middle' ? 'Середина' : 'Конец',
      'Номер ПУ': item.puNumber || ''
    };

    // Добавляем специфичные поля в зависимости от типа отчета
    if (reportType === 'problem_vl') {
      return {
        ...base,
        'Количество неудачных проверок': item.failureCount || 0,
        'Дата первого обращения': formatDate(item.firstReportDate),
        'Дата последней проверки': formatDate(item.lastErrorDate),
        'Последняя ошибка': item.lastErrorDetails || '',
        'Статус проблемы': item.status || ''
      };
    } else if (reportType === 'pending_work') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate)
      };
    } else if (reportType === 'pending_askue') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate),
        'Комментарий РЭС': item.resComment || '',
        'Дата завершения мероприятий': formatDate(item.workCompletedDate)
      };
    } else if (reportType === 'completed') {
      return {
        ...base,
        'Ошибка': item.errorDetails || '',
        'Дата обнаружения': formatDate(item.errorDate),
        'Комментарий РЭС': item.resComment || '',
        'Дата завершения мероприятий': formatDate(item.workCompletedDate),
        'Дата перепроверки': formatDate(item.recheckDate),
        'Результат': item.recheckResult === 'ok' ? 'Исправлено' : 'Не исправлено'
      };
    }
  });

  // Создаем новую книгу Excel
  const wb = XLSX.utils.book_new();
  
  // Создаем лист с данными
  const ws = XLSX.utils.json_to_sheet(exportData);
  
  // Устанавливаем ширину колонок в зависимости от типа отчета
  let columnWidths = [
    { wch: 20 }, // РЭС
    { wch: 15 }, // ТП
    { wch: 15 }, // ВЛ
    { wch: 12 }, // Позиция
    { wch: 15 }, // Номер ПУ
  ];
  
  if (reportType === 'problem_vl') {
    columnWidths.push(
      { wch: 25 }, // Количество неудачных проверок
      { wch: 20 }, // Дата первого обращения
      { wch: 20 }, // Дата последней проверки
      { wch: 50 }, // Последняя ошибка
      { wch: 15 }  // Статус проблемы
    );
  } else if (reportType === 'pending_work') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }  // Дата обнаружения
    );
  } else if (reportType === 'pending_askue') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }, // Дата обнаружения
      { wch: 40 }, // Комментарий РЭС
      { wch: 25 }  // Дата завершения мероприятий
    );
  } else if (reportType === 'completed') {
    columnWidths.push(
      { wch: 50 }, // Ошибка
      { wch: 18 }, // Дата обнаружения
      { wch: 40 }, // Комментарий РЭС
      { wch: 25 }, // Дата завершения мероприятий
      { wch: 18 }, // Дата перепроверки
      { wch: 15 }  // Результат
    );
  }
  
  ws['!cols'] = columnWidths;
  
  // Добавляем лист в книгу
  const sheetName = getReportTitle();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // Генерируем имя файла
  const fileName = `Отчет_${sheetName}_${new Date().toLocaleDateString('ru-RU').split('.').join('-')}.xlsx`;
  
  // Сохраняем файл
  XLSX.writeFile(wb, fileName);
  
  // Показываем уведомление
  alert(`Отчет успешно экспортирован в файл: ${fileName}`);
};

  // Вспомогательная функция для форматирования даты
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getReportTitle = () => {
    switch (reportType) {
      case 'pending_work':
        return 'Ожидающие мероприятий';
      case 'pending_askue':
        return 'Ожидающие проверки АСКУЭ';
      case 'completed':
        return 'Завершенные проверки';
      case 'problem_vl':
        return 'Проблемные ВЛ (2+ неудачных проверки)';
      default:
        return 'Отчет';
      }
  };

  // Фильтрация по ТП с мемоизацией
  const filteredData = useMemo(() => 
    reportData.filter(item => 
      !searchTp || item.tpName?.toLowerCase().includes(searchTp.toLowerCase())
    ), [reportData, searchTp]
  );

  if (loading) return <div className="loading">Загрузка отчета...</div>;

  return (
    <div className="reports">
      <h2>Отчеты по проверкам</h2>

      {user.role !== 'admin' && (
      <div className="res-indicator">
        <span>Показаны данные для: <strong>{user.resName}</strong></span>
      </div>
    )}
      
      <div className="report-controls">
        <div className="control-group">
          <label>Тип отчета:</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="pending_work">Ожидающие мероприятий</option>
            <option value="pending_askue">Ожидающие проверки АСКУЭ</option>
            <option value="completed">Завершенные проверки</option>
            <option value="problem_vl">Проблемные ВЛ (2+ ошибки)</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Период с:</label>
          <input 
            type="date" 
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <label>по:</label>
          <input 
            type="date" 
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <input 
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
          />
        </div>
        
        <button className="export-btn" onClick={exportToExcel}>
          📊 Экспорт в Excel
        </button>
      </div>
      
      <div className="report-summary">
        <h3>{getReportTitle()}</h3>
        <p>Найдено записей: {filteredData.length}</p>
      </div>
      
      <div className="report-table-wrapper" style={{ position: 'relative' }}>
  {loading && (
    <div className="loading-overlay">
      <div className="loading-spinner">
        <div className="spinner"></div>
        <span>Обновление данных...</span>
      </div>
    </div>
  )}
  
  <div className={`report-table ${loading ? 'loading' : ''}`}>
    <table>
      <thead>
        <tr>
          <th>РЭС</th>
          <th>ТП</th>
          <th>ВЛ</th>
          <th>Позиция</th>
          <th>Номер ПУ</th>
          
          {/* Разные колонки для разных типов отчетов */}
          {reportType === 'problem_vl' ? (
            <>
              <th>Кол-во ошибок</th>
              <th>Первое обращение</th>
              <th>Последняя проверка</th>
              <th>Последняя ошибка</th>
              <th>Статус</th>
            </>
          ) : reportType === 'pending_work' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
            </>
          ) : reportType === 'pending_askue' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
              <th>Комментарий РЭС</th>
              <th>Дата завершения мероприятий</th>
            </>
          ) : reportType === 'completed' ? (
            <>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
              <th>Комментарий РЭС</th>
              <th>Дата завершения мероприятий</th>
              <th>Дата перепроверки</th>
              <th>Результат</th>
              <th>Файлы</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {filteredData.map((item, idx) => (
          <tr key={idx}>
            <td>{item.resName}</td>
            <td>{item.tpName}</td>
            <td>{item.vlName}</td>
            <td>{item.position === 'start' ? 'Начало' : item.position === 'middle' ? 'Середина' : 'Конец'}</td>
            <td>{item.puNumber}</td>
            
            {/* Данные для проблемных ВЛ */}
            {reportType === 'problem_vl' ? (
              <>
                <td>
                  <span className="failure-count-badge">{item.failureCount}</span>
                </td>
                <td>{new Date(item.firstReportDate).toLocaleDateString('ru-RU')}</td>
                <td>{new Date(item.lastErrorDate).toLocaleDateString('ru-RU')}</td>
                <td className="error-cell">{item.lastErrorDetails}</td>
                <td>
                  <span className={`status-badge ${
                    item.status === 'Активная' ? 'status-active' : 
                    item.status === 'Решена' ? 'status-resolved' : 
                    'status-dismissed'
                  }`}>
                    {item.status}
                  </span>
                </td>
              </>
            
            /* Данные для ожидающих мероприятий */
            ) : reportType === 'pending_work' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
              </>
            
            /* Данные для ожидающих АСКУЭ */
            ) : reportType === 'pending_askue' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
                <td>{item.resComment}</td>
                <td>{new Date(item.workCompletedDate).toLocaleDateString('ru-RU')}</td>
              </>
            
            /* Данные для завершенных проверок */
            ) : reportType === 'completed' ? (
              <>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
                <td>{item.resComment}</td>
                <td>{new Date(item.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td>{new Date(item.recheckDate).toLocaleDateString('ru-RU')}</td>
                <td className="status-cell">
                  <span 
                    className={item.recheckResult === 'ok' ? 'status-ok clickable' : 'status-error clickable'}
                    onClick={() => {
                      setSelectedComment({
                        comment: item.resComment,
                        tpName: item.tpName,
                        vlName: item.vlName,
                        puNumber: item.puNumber,
                        result: item.recheckResult
                      });
                      setShowCommentModal(true);
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Нажмите для просмотра комментария"
                  >
                    {item.recheckResult === 'ok' ? '✅ Исправлено' : '❌ Не исправлено'}
                  </span>
                </td>
                <td>
                  {item.attachments && item.attachments.length > 0 ? (
                    <button 
                      className="btn-view-files"
                      onClick={() => viewAttachments(item.attachments)}
                    >
                      📎 {item.attachments.length} файл(ов)
                    </button>
                  ) : (
                    <span className="no-files">—</span>
                  )}
                </td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
      
      {filteredData.length === 0 && (
        <div className="no-data">
          <p>Нет данных для отображения за выбранный период</p>
        </div>
      )}
      
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    
{/* Модальное окно для комментария */}
{showCommentModal && selectedComment && (
  <div className="modal-backdrop" onClick={() => setShowCommentModal(false)}>
    <div className="modal-content comment-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h3>Комментарий РЭС</h3>
        <button className="close-btn" onClick={() => setShowCommentModal(false)}>✕</button>
      </div>
      
      <div className="modal-body">
        <div className="comment-info">
          <p><strong>ТП:</strong> {selectedComment.tpName}</p>
          <p><strong>ВЛ:</strong> {selectedComment.vlName}</p>
          <p><strong>ПУ №:</strong> {selectedComment.puNumber}</p>
          <p><strong>Результат:</strong> 
            <span className={selectedComment.result === 'ok' ? 'status-ok' : 'status-error'}>
              {selectedComment.result === 'ok' ? '✅ Исправлено' : '❌ Не исправлено'}
            </span>
          </p>
        </div>
        
        <div className="comment-content">
          <h4>Выполненные работы:</h4>
          <p>{selectedComment.comment}</p>
        </div>
      </div>
      
      <div className="modal-footer">
        <button className="action-btn" onClick={() => setShowCommentModal(false)}>
          Закрыть
        </button>
      </div>
    </div>
  </div>
)}
</div>
  );

}

// =====================================================
// КОМПОНЕНТ ПРОБЛЕМНЫХ ВЛ (2+ НЕУДАЧНЫХ ПРОВЕРКИ)
// =====================================================

function ProblemVL() {
  const [problemVLs, setProblemVLs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsProblem, setDetailsProblem] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailProblem, setEmailProblem] = useState(null);

  useEffect(() => {
    loadProblemVLs();
    
    const handleUpdate = () => loadProblemVLs();
    window.addEventListener('problemVLUpdated', handleUpdate);
    
    return () => {
      window.removeEventListener('problemVLUpdated', handleUpdate);
    };
  }, []);

const handleSendEmail = async () => {
    try {
      await api.post(`/api/problem-vl/${emailProblem.id}/send-email`);
      alert('Письмо отправлено ответственному РЭС');
      setShowEmailModal(false);
      setEmailProblem(null);
    } catch (error) {
      alert('Ошибка отправки письма: ' + error.response?.data?.error || error.message);
    }
  };
  
  const loadProblemVLs = async () => {
    try {
      const response = await api.get('/api/problem-vl/list');
      setProblemVLs(response.data);
    } catch (error) {
      console.error('Error loading problem VLs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await api.put(`/api/problem-vl/${selectedProblem.id}/dismiss`, {
        password: deletePassword
      });
      
      alert('Проблема отклонена');
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedProblem(null);
      loadProblemVLs();
    } catch (error) {
      alert('Ошибка: ' + (error.response?.data?.error || error.message));
    }
  };

  if (loading) return <div className="loading">Загрузка проблемных ВЛ...</div>;

  return (
    <div className="problem-vl-container">
      <h2>Проблемные ВЛ</h2>
      
      <div className="problem-info">
        <p>В этом разделе отображаются ВЛ, которые не прошли проверку 2 и более раз после выполнения мероприятий РЭС.</p>
        <p>Это требует особого внимания и возможного выезда на место.</p>
      </div>
      
      <div className="problem-stats">
        <div className="stat-card critical">
          <h4>Активных проблем</h4>
          <p className="stat-value">{problemVLs.filter(p => p.status === 'active').length}</p>
        </div>
        <div className="stat-card">
          <h4>Всего зарегистрировано</h4>
          <p className="stat-value">{problemVLs.length}</p>
        </div>
      </div>
      
      {problemVLs.length === 0 ? (
  <div className="no-data">
    <p>
      <img src="/icons/ok.png" alt="OK" style={{width: 110, height: 140, verticalAlign: 'middle', marginRight: 8}} />
      Проблемных ВЛ нет
    </p>
  </div>
      ) : (
        <div className="problem-list">
          {problemVLs.map(problem => (
            <div key={problem.id} className="problem-card">
              <div className="problem-header">
                <div>
                  <h3>{problem.tpName} - {problem.vlName}</h3>
                  <span className="res-badge">{problem.ResUnit?.name}</span>
                </div>
                <span className="failure-badge critical">
                  ❌ {problem.failureCount} неудачных проверок
                </span>
              </div>
              
              <div className="problem-details">
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">ПУ №:</span>
                    <span className="value">{problem.puNumber}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Позиция:</span>
                    <span className="value">
                      {problem.position === 'start' ? 'Начало' :
                       problem.position === 'middle' ? 'Середина' : 'Конец'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Первое обращение:</span>
                    <span className="value">
                      {new Date(problem.firstReportDate).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Последняя проверка:</span>
                    <span className="value">
                      {new Date(problem.lastErrorDate).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="problem-error">
                <strong>Последняя ошибка:</strong>
                <p>{problem.lastErrorDetails}</p>
              </div>
              
              {problem.resComment && (
                <div className="problem-comment">
                  <strong>Комментарий РЭС:</strong>
                  <p>{problem.resComment}</p>
                </div>
              )}
              
              <div className="problem-actions">
                <button 
                  className="btn-details"
                  onClick={() => {
                    setDetailsProblem(problem);
                    setShowDetailsModal(true);
                  }}
                >
                  🔍 Подробности
                </button>
               <button 
                  className="btn-email"
                  onClick={() => {
                    setEmailProblem(problem);
                    setShowEmailModal(true);
                  }}
                >
                  📧 Направить письмо исполнителю
                </button>
                <button 
                  className="btn-dismiss"
                  onClick={() => {
                    setSelectedProblem(problem);
                    setShowDeleteModal(true);
                  }}
                >
                  ✅ Рассмотреть без объяснительной
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Модальное окно подтверждения отклонения */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Рассмотреть без объяснительной</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы уверены, что хотите закрыть эту проблему без объяснительной записки?</p>
              <div className="problem-summary">
                <p><strong>{selectedProblem?.tpName} - {selectedProblem?.vlName}</strong></p>
                <p>ПУ №{selectedProblem?.puNumber} ({selectedProblem?.failureCount} ошибок)</p>
              </div>
              <p className="warning">⚠️ Проблема будет закрыта без дальнейших действий!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDismiss}
                disabled={!deletePassword}
              >
                Закрыть без объяснительной
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно с подробностями */}
      {showDetailsModal && detailsProblem && (
        <div className="modal-backdrop" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подробная информация о проблемной ВЛ</h3>
              <button className="close-btn" onClick={() => setShowDetailsModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <h4>{detailsProblem.tpName} - {detailsProblem.vlName}</h4>
              
              <div className="detail-section">
                <h5>Общая информация:</h5>
                <div className="detail-row">
                  <strong>РЭС:</strong> {detailsProblem.ResUnit?.name}
                </div>
                <div className="detail-row">
                  <strong>ПУ №:</strong> {detailsProblem.puNumber}
                </div>
                <div className="detail-row">
                  <strong>Позиция:</strong> {
                    detailsProblem.position === 'start' ? 'Начало' :
                    detailsProblem.position === 'middle' ? 'Середина' : 'Конец'
                  }
                </div>
              </div>
              
              <div className="detail-section">
                <h5>История проблемы:</h5>
                <div className="detail-row">
                  <strong>Первое обращение:</strong> {new Date(detailsProblem.firstReportDate).toLocaleString('ru-RU')}
                </div>
                <div className="detail-row">
                  <strong>Последняя проверка:</strong> {new Date(detailsProblem.lastErrorDate).toLocaleString('ru-RU')}
                </div>
                <div className="detail-row">
                  <strong>Количество неудачных проверок:</strong> <span className="failure-count">{detailsProblem.failureCount}</span>
                </div>
              </div>
              
              <div className="error-details-box">
                <strong>Последняя ошибка:</strong>
                <p>{detailsProblem.lastErrorDetails}</p>
              </div>
              
              {detailsProblem.resComment && (
                <div className="comment-box">
                  <strong>Последний комментарий РЭС:</strong>
                  <p>{detailsProblem.resComment}</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="action-btn" onClick={() => setShowDetailsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      
    {/* НОВОЕ: Модальное окно отправки письма */}
      {showEmailModal && emailProblem && (
        <div className="modal-backdrop" onClick={() => setShowEmailModal(false)}>
          <div className="modal-content email-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Направить письмо исполнителю</h3>
              <button className="close-btn" onClick={() => setShowEmailModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Будет отправлено уведомление ответственному РЭС с требованием предоставить объяснительную записку.</p>
              <div className="problem-summary">
                <p><strong>РЭС:</strong> {emailProblem.ResUnit?.name}</p>
                <p><strong>ТП:</strong> {emailProblem.tpName}</p>
                <p><strong>ВЛ:</strong> {emailProblem.vlName}</p>
                <p><strong>ПУ №:</strong> {emailProblem.puNumber}</p>
                <p><strong>Количество неудачных проверок:</strong> {emailProblem.failureCount}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowEmailModal(false)}>
                Отмена
              </button>
              <button 
                className="primary-btn" 
                onClick={handleSendEmail}
              >
                📧 Отправить уведомление
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// =====================================================
// КОМПОНЕНТ НАСТРОЕК С УПРАВЛЕНИЕМ ПОЛЬЗОВАТЕЛЯМИ
// =====================================================

function Settings() {
  const [activeTab, setActiveTab] = useState('structure');
  
  return (
    <div className="settings-container">
      <h2>Настройки системы</h2>
      
      <div className="settings-tabs">
        <button 
          className={activeTab === 'structure' ? 'active' : ''}
          onClick={() => setActiveTab('structure')}
        >
          Структура сети
        </button>
        <button 
          className={activeTab === 'users' ? 'active' : ''}
          onClick={() => setActiveTab('users')}
        >
          Пользователи
        </button>
        <button 
          className={activeTab === 'maintenance' ? 'active' : ''}
          onClick={() => setActiveTab('maintenance')}
        >
          Обслуживание
        </button>
        <button 
          className={activeTab === 'files' ? 'active' : ''}
          onClick={() => setActiveTab('files')}
        >
          Управление файлами
        </button>
      </div>
      
      <div className="settings-content">
        {activeTab === 'structure' && <StructureSettings />}
        {activeTab === 'users' && <UserSettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
        {activeTab === 'files' && <FileManagement />}
      </div>
    </div>
  );
}
// Новый подкомпонент управления файлами
function FileManagement() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  useEffect(() => {
    loadFiles();
  }, []);
  
  const loadFiles = async () => {
    try {
      console.log('Loading files...');
      const response = await api.get('/api/admin/files');
      console.log('Files response:', response.data);
      setFiles(response.data.files);
    } catch (error) {
      console.error('Error loading files:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeleteFile = async () => {
  try {
    // ИЗМЕНИТЬ ЭТУ СТРОКУ - добавить encodeURIComponent
    const publicId = selectedFile.public_id || selectedFile.filename;
    
    await api.delete(`/api/admin/files/${encodeURIComponent(publicId)}`, {
      data: { password: deletePassword }
    });
    
    alert('Файл удален успешно');
    setShowDeleteModal(false);
    setDeletePassword('');
    setSelectedFile(null);
    loadFiles();
    
  } catch (error) {
    console.error('Delete error:', error);
    alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
  }
};
  
  const getTotalSize = () => {
    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    return (totalBytes / 1024 / 1024).toFixed(2);
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  
  return (
    <div className="settings-section">
      <h3>Управление загруженными файлами</h3>
      
      <div className="file-stats">
        <div className="stat-card">
          <h4>Всего файлов</h4>
          <p className="stat-value">{files.length}</p>
        </div>
        <div className="stat-card">
          <h4>Общий размер</h4>
          <p className="stat-value">{getTotalSize()} MB</p>
        </div>
      </div>
      
      <div className="files-grid">
        {files.map((file, idx) => (
          <div key={idx} className="file-card">
            {(file.url.toLowerCase().endsWith('.jpg') || 
              file.url.toLowerCase().endsWith('.jpeg') || 
              file.url.toLowerCase().endsWith('.png') || 
              file.url.toLowerCase().endsWith('.gif')) ? (
              <img src={file.url} alt={file.original_name} className="file-thumbnail" />
            ) : (
              <div className="file-icon">📄</div>
            )}
            
            <div className="file-info">
              <p className="file-name">{file.original_name}</p>
              <p className="file-meta">
                РЭС: {file.resName}<br/>
                ТП: {file.tpName}<br/>
                ПУ: {file.puNumber}<br/>
                Дата: {new Date(file.uploadDate).toLocaleDateString('ru-RU')}
              </p>
            </div>
            
            <div className="file-actions">
              <a 
                href={file.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn-icon"
                title="Открыть"
              >
                👁️
              </a>
              <button 
                onClick={() => {
                  setSelectedFile(file);
                  setShowDeleteModal(true);
                }}
                className="btn-icon danger"
                title="Удалить"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {/* Модальное окно удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления файла</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить файл:</p>
              <p><strong>{selectedFile?.original_name}</strong></p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteFile}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Просмотрщик файлов */}
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    </div>
  );
}
// Подкомпонент настроек структуры
function StructureSettings() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadStats, setUploadStats] = useState(null);
  
  
  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setMessage('');
    setUploadStats(null);
  };

  const handleUploadStructure = async () => {
    if (!file) {
      alert('Выберите файл');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await api.post('/api/network/upload-full-structure', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setMessage('✅ Структура сети успешно загружена!');
      setUploadStats(response.data);
      setFile(null);
      
      // Создаем событие для обновления структуры
      window.dispatchEvent(new CustomEvent('structureUpdated'));
      
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('❌ Ошибка загрузки: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
      setUploadStats(null);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div className="settings-section">
      <h3>Загрузка структуры сети</h3>
      <p className="section-description">
        Загрузите Excel файл со структурой сети. Формат: РЭС | ТП | Фидер | Начало | Середина | Конец
      </p>
      
      <div className="upload-area">
        <input 
          type="file" 
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          id="structure-file"
        />
        <label htmlFor="structure-file" className="file-label">
          {file ? file.name : 'Выберите файл Excel'}
        </label>
      </div>
      
      <button 
        onClick={handleUploadStructure} 
        disabled={uploading || !file}
        className="primary-btn"
      >
        {uploading ? 'Загрузка...' : 'Загрузить структуру'}
      </button>
      
      {message && (
        <div className={message.includes('✅') ? 'success-message' : 'error-message'}>
          {message}
        </div>
      )}
      
      {uploadStats && (
        <div className="upload-stats">
          <h4>Результаты загрузки:</h4>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Обработано:</span>
              <span className="stat-value">{uploadStats.processed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Всего записей:</span>
              <span className="stat-value">{uploadStats.total}</span>
            </div>
          </div>
          {uploadStats.errors && uploadStats.errors.length > 0 && (
            <div className="errors-list">
              <p>⚠️ Ошибки при загрузке:</p>
              <ul>
                {uploadStats.errors.slice(0, 5).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              {uploadStats.errors.length > 5 && (
                <p>... и еще {uploadStats.errors.length - 5} ошибок</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Подкомпонент управления пользователями
function UserSettings() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resList, setResList] = useState([]);
  
  // Форма для создания/редактирования
  const [userForm, setUserForm] = useState({
    fio: '',
    login: '',
    password: '',
    email: '',
    role: 'uploader',
    resId: ''
  });
  
  useEffect(() => {
    loadUsers();
    loadResList();
  }, []);
  
  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/users/list');
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };
  
  const handleCreateUser = async () => {
    try {
      await api.post('/api/users/create', userForm);
      alert('Пользователь создан успешно');
      setShowCreateModal(false);
      setUserForm({
        fio: '',
        login: '',
        password: '',
        email: '',
        role: 'uploader',
        resId: ''
      });
      loadUsers();
    } catch (error) {
      alert('Ошибка создания пользователя: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const handleUpdateUser = async () => {
    try {
      await api.put(`/api/users/${editingUser.id}`, userForm);
      alert('Пользователь обновлен успешно');
      setShowEditModal(false);
      setEditingUser(null);
      loadUsers();
    } catch (error) {
      alert('Ошибка обновления пользователя: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const handleDeleteUser = async (userId) => {
    if (!confirm('Удалить пользователя?')) return;
    
    const password = prompt('Введите пароль администратора:');
    if (!password) return;
    
    try {
      await api.delete(`/api/users/${userId}`, { data: { password } });
      alert('Пользователь удален');
      loadUsers();
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const startEdit = (user) => {
    setEditingUser(user);
    setUserForm({
      fio: user.fio,
      login: user.login,
      password: '',
      email: user.email,
      role: user.role,
      resId: user.resId || ''
    });
    setShowEditModal(true);
  };
  
  
  return (
    <div className="settings-section">
      <div className="section-header">
        <h3>Управление пользователями</h3>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="primary-btn">
            Новый пользователь
          </button>
        </div>
      </div>
      
      <div className="users-table-container">
        {loading ? (
          <div className="loading">Загрузка...</div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>РЭС</th>
                <th>Email</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.fio}</td>
                  <td><strong>{user.login}</strong></td>
                  <td>
                    <span className={`role-badge role-${user.role}`}>
                      {user.role === 'admin' ? 'Админ' : 
                       user.role === 'uploader' ? 'АСКУЭ' : 
                       'ТЕХБЛОК'}
                    </span>
                  </td>
                  <td>{user.ResUnit?.name || '-'}</td>
                  <td>{user.email}</td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        onClick={() => startEdit(user)}
                        className="btn-icon"
                        title="Редактировать"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => handleDeleteUser(user.id)}
                        className="btn-icon danger"
                        title="Удалить"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {/* Модальное окно создания пользователя */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content user-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Создание пользователя</h3>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>ФИО</label>
                <input
                  type="text"
                  value={userForm.fio}
                  onChange={(e) => setUserForm({...userForm, fio: e.target.value})}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              
              <div className="form-group">
                <label>Логин</label>
                <input
                  type="text"
                  value={userForm.login}
                  onChange={(e) => setUserForm({...userForm, login: e.target.value})}
                  placeholder="ivanov"
                />
              </div>
              
              <div className="form-group">
                <label>Пароль</label>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                  placeholder="Минимум 6 символов"
                />
              </div>
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                  placeholder="ivanov@res.ru"
                />
              </div>
              
              <div className="form-group">
                <label>Роль</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                >
                  <option value="admin">Администратор</option>
                  <option value="uploader">Загрузчик АСКУЭ</option>
                  <option value="res_responsible">Ответственный РЭС</option>
                </select>
              </div>
              
              {userForm.role !== 'admin' && (
                <div className="form-group">
                  <label>РЭС</label>
                  <select
                    value={userForm.resId}
                    onChange={(e) => setUserForm({...userForm, resId: e.target.value})}
                  >
                    <option value="">Выберите РЭС</option>
                    {resList.map(res => (
                      <option key={res.id} value={res.id}>{res.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                Отмена
              </button>
              <button 
                className="primary-btn" 
                onClick={handleCreateUser}
                disabled={!userForm.fio || !userForm.login || !userForm.password || !userForm.email}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно редактирования (аналогично создания) */}
      {showEditModal && (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal-content user-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Редактирование пользователя</h3>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>ФИО</label>
                <input
                  type="text"
                  value={userForm.fio}
                  onChange={(e) => setUserForm({...userForm, fio: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Логин</label>
                <input
                  type="text"
                  value={userForm.login}
                  onChange={(e) => setUserForm({...userForm, login: e.target.value})}
                  disabled
                />
              </div>
              
              <div className="form-group">
                <label>Новый пароль (оставьте пустым чтобы не менять)</label>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                  placeholder="Оставьте пустым"
                />
              </div>
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Роль</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                >
                  <option value="admin">Администратор</option>
                  <option value="uploader">Загрузчик АСКУЭ</option>
                  <option value="res_responsible">Ответственный РЭС</option>
                </select>
              </div>
              
              {userForm.role !== 'admin' && (
                <div className="form-group">
                  <label>РЭС</label>
                  <select
                    value={userForm.resId}
                    onChange={(e) => setUserForm({...userForm, resId: e.target.value})}
                  >
                    <option value="">Выберите РЭС</option>
                    {resList.map(res => (
                      <option key={res.id} value={res.id}>{res.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowEditModal(false)}>
                Отмена
              </button>
              <button 
                className="primary-btn" 
                onClick={handleUpdateUser}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Подкомпонент обслуживания системы
function MaintenanceSettings() {
  const [clearing, setClearing] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearPassword, setClearPassword] = useState('');
  const [clearBeforeDate, setClearBeforeDate] = useState(''); // НОВОЕ
  
  const handleClearAll = async () => {
    setClearing(true);
    try {
      const response = await api.delete('/api/network/clear-all', {
        data: { 
          password: clearPassword,
          beforeDate: clearBeforeDate  // ДОБАВИЛИ
        }
      });
      
      alert(response.data.message);
      setShowClearModal(false);
      setClearPassword('');
      setClearBeforeDate(''); // ДОБАВИЛИ
      
      window.dispatchEvent(new CustomEvent('dataCleared'));
      
    } catch (error) {
      alert('❌ Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
      setClearing(false);
    }
  };
  
  return (
    <div className="settings-section">
      <h3>Обслуживание системы</h3>
      
      <div className="maintenance-card danger">
        <h4>⚠️ Очистка данных системы</h4>
        <p>Удаляет историю, статусы проверок и уведомления.</p>
        <p className="info-text">✅ Структура сети НЕ удаляется!</p>
        <button 
          onClick={() => setShowClearModal(true)}
          disabled={clearing}
          className="danger-btn"
        >
          {clearing ? 'Удаление...' : '🗑️ Очистить данные'}
        </button>
      </div>
      
      <div className="maintenance-card">
        <h4>📊 Статистика системы</h4>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Версия системы:</span>
            <span className="stat-value">2.0.1</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">База данных:</span>
            <span className="stat-value">PostgreSQL</span>
          </div>
        </div>
      </div>
      
      {/* Модифицированное модальное окно */}
      {showClearModal && (
        <div className="modal-backdrop" onClick={() => setShowClearModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Очистка данных системы</h3>
              <button className="close-btn" onClick={() => setShowClearModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* НОВОЕ: выбор периода */}
              <div className="form-group">
                <label>Удалить данные до (необязательно):</label>
                <input
                  type="date"
                  value={clearBeforeDate}
                  onChange={(e) => setClearBeforeDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
                {clearBeforeDate && (
                  <p className="info">
                    ℹ️ Будут удалены данные до {new Date(clearBeforeDate).toLocaleDateString('ru-RU')}
                  </p>
                )}
                {!clearBeforeDate && (
                  <p className="info">
                    ℹ️ Если дата не указана - будет удалена ВСЯ история
                  </p>
                )}
              </div>
              
              <p className="warning">⚠️ ВНИМАНИЕ! Будут удалены:</p>
              <ul>
                <li>❌ <s>Структура сети</s> <span style={{color: 'green'}}>НЕ УДАЛЯЕТСЯ</span></li>
                <li>Все статусы проверок {clearBeforeDate && 'за указанный период'}</li>
                <li>Все уведомления {clearBeforeDate && 'за указанный период'}</li>
                <li>Вся история загрузок {clearBeforeDate && 'за указанный период'}</li>
                <li>Вся история проверок {clearBeforeDate && 'за указанный период'}</li>
              </ul>
              <p className="warning">Это действие НЕЛЬЗЯ отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={clearPassword}
                  onChange={(e) => setClearPassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowClearModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleClearAll}
                disabled={!clearPassword || clearing}
              >
                {clearing ? 'Удаление...' : clearBeforeDate ? 'Удалить старые данные' : 'Удалить всё'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// ОСНОВНОЕ ПРИЛОЖЕНИЕ
// =====================================================

// =====================================================
// Компонент для просмотра файлов
// =====================================================
function FileViewer({ files, currentIndex, onClose, onNext, onPrev }) {
  console.log('FileViewer files:', files);
  console.log('Current file:', files[currentIndex]);
  
  const currentFile = files[currentIndex];
  const url = currentFile.url.toLowerCase();
  const isImage = url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.gif');
  const isPdf = url.endsWith('.pdf');
  
  return (
    <div className="modal-backdrop file-viewer-backdrop" onClick={onClose}>
      <div className="file-viewer-container" onClick={e => e.stopPropagation()}>
        <div className="file-viewer-header">
          <h3>Просмотр файлов ({currentIndex + 1} из {files.length})</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="file-viewer-content">
          {isImage ? (
            <img 
              src={currentFile.url} 
              alt={currentFile.original_name}
              className="file-viewer-image"
            />
          ) : isPdf ? (
            <div className="pdf-viewer">
              <iframe 
                src={currentFile.url} 
                width="100%" 
                height="600px"
                title={currentFile.original_name}
              />
              <a 
                href={currentFile.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="pdf-download-link"
              >
                📥 Открыть PDF в новой вкладке
              </a>
            </div>
          ) : (
            <div className="file-not-supported">
              <p>Предпросмотр недоступен</p>
              <a 
                href={currentFile.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="download-link"
              >
                📥 Скачать файл
              </a>
            </div>
          )}
        </div>
        
        <div className="file-viewer-info">
          <p><strong>Имя файла:</strong> {currentFile.original_name}</p>
          <p><strong>Загружен:</strong> {new Date(currentFile.uploaded_at).toLocaleString('ru-RU')}</p>
        </div>
        
        {files.length > 1 && (
          <div className="file-viewer-navigation">
            <button onClick={onPrev} className="nav-btn">
              ← Предыдущий
            </button>
            <button onClick={onNext} className="nav-btn">
              Следующий →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ЗАГРУЖЕННЫХ ДОКУМЕНТОВ
// =====================================================

function UploadedDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const { user, selectedRes } = useContext(AuthContext);
  
  const [deleteRecordId, setDeleteRecordId] = useState(null);
  const [showDeleteRecordModal, setShowDeleteRecordModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  
  useEffect(() => {
    loadDocuments();
  }, []);
  
  const loadDocuments = async () => {
    try {
      const params = selectedRes ? `?resId=${selectedRes}` : '';
      const response = await api.get('/api/documents/list');
      setDocuments(response.data);
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleViewFile = (files) => {
    setSelectedFiles(files);
    setCurrentFileIndex(0);
    setShowFileViewer(true);
  };
  
  const handleDeleteFile = async () => {
    try {
      await api.delete(`/api/documents/${selectedFile.recordId}/${selectedFile.fileIndex}`, {
        data: { password: deletePassword }
      });
      
      alert('Файл удален успешно');
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedFile(null);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const handleDeleteRecord = async () => {
    try {
      await api.delete(`/api/documents/record/${deleteRecordId}`, {
        data: { password: deletePassword }
      });
      
      alert('Запись удалена успешно');
      setShowDeleteRecordModal(false);
      setDeletePassword('');
      setDeleteRecordId(null);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSelectRecord = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.length === documents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(documents.map(doc => doc.id));
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.post('/api/documents/delete-bulk', {
        ids: selectedIds,
        password: deletePassword
      });
      
      alert(`Удалено записей: ${selectedIds.length}`);
      setShowBulkDeleteModal(false);
      setDeletePassword('');
      setSelectedIds([]);
      loadDocuments();
      
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  if (loading) return <div className="loading">Загрузка документов...</div>;
  
  return (
    <div className="uploaded-documents">
      <h2>Загруженные документы</h2>
      
      <div className="documents-controls">
        <div className="documents-info">
          <p>Всего документов: <strong>{documents.reduce((sum, doc) => sum + (doc.attachments?.length || 0), 0)}</strong></p>
        </div>
        
        {user.role === 'admin' && selectedIds.length > 0 && (
    <div className="selected-actions">
      <button 
        className="clear-history-selected-btn"
        onClick={handleClearTpHistory}
      >
        🧹 Очистить историю выбранных ({selectedIds.length})
      </button>
      
      <button 
        className="delete-selected-btn"
        onClick={() => setShowDeleteModal(true)}
      >
        🗑️ Удалить выбранные ({selectedIds.length})
      </button>
    </div>
  )}
</div>
      
      <div className="documents-table">
        <table>
          <thead>
            <tr>
              {user.role === 'admin' && (
                <th className="checkbox-column">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === documents.length && documents.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              <th>ТП</th>
              <th>ВЛ</th>
              <th>ПУ №</th>
              <th>Загрузил</th>
              <th>Дата загрузки</th>
              <th>Комментарий</th>
              <th>Статус</th>
              <th>Файлы</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className={selectedIds.includes(doc.id) ? 'selected' : ''}>
                {user.role === 'admin' && (
                  <td className="checkbox-column">
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(doc.id)}
                      onChange={() => handleSelectRecord(doc.id)}
                    />
                  </td>
                )}
                <td>{doc.tpName}</td>
                <td>{doc.vlName}</td>
                <td><strong>{doc.puNumber}</strong></td>
                <td>{doc.uploadedBy}</td>
                <td>{new Date(doc.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                <td className="comment-cell">{doc.resComment}</td>
                <td>
                  <span className={`status-badge status-${doc.status}`}>
                    {doc.status === 'completed' ? '✅ Завершен' : '⏳ На проверке'}
                  </span>
                </td>
                <td>
                  <span className="file-count">{doc.attachments?.length || 0} файл(ов)</span>
                </td>
                <td>
                  <div className="action-buttons">
                    {doc.attachments && doc.attachments.length > 0 && (
                      <button 
                        className="btn-view"
                        onClick={() => handleViewFile(doc.attachments)}
                        title="Просмотреть"
                      >
                        👁️
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {documents.length === 0 && (
        <div className="no-data">
          <p>Пока нет загруженных документов</p>
        </div>
      )}

      {/* Модальное окно массового удаления */}
      {showBulkDeleteModal && (
        <div className="modal-backdrop" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedIds.length} записей.</p>
              <p>Все связанные файлы также будут удалены.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => {setShowBulkDeleteModal(false); setDeletePassword('');}}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleBulkDelete}
                disabled={!deletePassword}
              >
                Удалить выбранные
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно удаления записи */}
      {showDeleteRecordModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteRecordModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления записи</h3>
              <button className="close-btn" onClick={() => setShowDeleteRecordModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить всю запись вместе со всеми файлами.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteRecordModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteRecord}
                disabled={!deletePassword}
              >
                Удалить запись
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно удаления файла */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления файла</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить файл:</p>
              <p><strong>{selectedFile?.original_name}</strong></p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteFile}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Просмотрщик файлов */}
      {showFileViewer && (
        <FileViewer 
          files={selectedFiles}
          currentIndex={currentFileIndex}
          onClose={() => setShowFileViewer(false)}
          onNext={() => setCurrentFileIndex((prev) => (prev + 1) % selectedFiles.length)}
          onPrev={() => setCurrentFileIndex((prev) => (prev - 1 + selectedFiles.length) % selectedFiles.length)}
        />
      )}
    </div>
  );
}


// Новый компонент расширенного модального окна
function ExtendedPuModal({ 
  isOpen, 
  onClose, 
  puData, 
  activeTab, 
  setActiveTab, 
  uploadHistory, 
  checkHistory, 
  loading,
  handleClearPuHistory
}) {
  const { user } = useContext(AuthContext);
  if (!isOpen || !puData) return null;
  
  // Парсим детали ошибки для отображения фаз
  const getPhaseErrors = () => {
    const phases = { A: false, B: false, C: false };
    
    if (puData.status.errorDetails) {
      try {
        const parsed = JSON.parse(puData.status.errorDetails);
        const errorSummary = parsed.summary || puData.status.errorDetails;
        
        if (errorSummary.indexOf('Фаза A') !== -1) phases.A = true;
        if (errorSummary.indexOf('Фаза B') !== -1) phases.B = true;
        if (errorSummary.indexOf('Фаза C') !== -1) phases.C = true;
      } catch (e) {
        // Если не JSON, проверяем как текст
        const errorText = puData.status.errorDetails;
        if (errorText.indexOf('Фаза A') !== -1) phases.A = true;
        if (errorText.indexOf('Фаза B') !== -1) phases.B = true;
        if (errorText.indexOf('Фаза C') !== -1) phases.C = true;
      }
    }
    
    return phases;
  };
  
  const phaseErrors = getPhaseErrors();
  
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content extended-pu-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>ПУ #{puData.puNumber} - Детальная информация</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        {/* Информация о местоположении */}
        <div className="pu-location-info">
          <p><strong>РЭС:</strong> {puData.resName}</p>
          <p><strong>ТП:</strong> {puData.tpName}</p>
          <p><strong>Фидер:</strong> {puData.vlName}</p>
          <p><strong>Позиция:</strong> {
            puData.position === 'start' ? 'Начало' : 
            puData.position === 'middle' ? 'Середина' : 'Конец'
          }</p>
        </div>
        
        {/* Вкладки */}
        <div className="modal-tabs">
          <button 
            className={`tab-btn ${activeTab === 'current' ? 'active' : ''}`}
            onClick={() => setActiveTab('current')}
          >
            Текущее состояние
          </button>
          <button 
            className={`tab-btn ${activeTab === 'uploads' ? 'active' : ''}`}
            onClick={() => setActiveTab('uploads')}
          >
            История загрузок ({uploadHistory.length})
          </button>
          <button 
            className={`tab-btn ${activeTab === 'checks' ? 'active' : ''}`}
            onClick={() => setActiveTab('checks')}
          >
            История проверок ({checkHistory.length})
          </button>
        </div>
        
        <div className="modal-body">
          {loading ? (
            <div className="loading">Загрузка истории...</div>
          ) : (
            <>
              {/* Вкладка текущего состояния */}
              {activeTab === 'current' && (
                <div className="tab-content">
                  {puData.status.status === 'checked_error' ? (
                    <>
                      <div className="phase-indicators-large">
                        <div className={`phase-indicator ${phaseErrors.A ? 'phase-error' : ''}`}>A</div>
                        <div className={`phase-indicator ${phaseErrors.B ? 'phase-error' : ''}`}>B</div>
                        <div className={`phase-indicator ${phaseErrors.C ? 'phase-error' : ''}`}>C</div>
                      </div>
                      
                      <div className="error-details-box">
                        <h4>Обнаруженные отклонения:</h4>
                        <div className="error-text">
                          {(() => {
                            try {
                              const parsed = JSON.parse(puData.status.errorDetails);
                              return parsed.summary || puData.status.errorDetails;
                            } catch {
                              return puData.status.errorDetails;
                            }
                          })()}
                        </div>
                      </div>
                      
                      <div className="error-meta">
                        <p><strong>Последняя проверка:</strong> {
                          puData.status.lastCheck 
                            ? new Date(puData.status.lastCheck).toLocaleString('ru-RU')
                            : 'Неизвестно'
                        }</p>
                      </div>
                    </>
                  ) : puData.status.status === 'checked_ok' ? (
                    <div className="success-state">
                      <div className="success-icon">✅</div>
                      <h4>Проверен без ошибок</h4>
                      <p>Последняя проверка: {
                        puData.status.lastCheck 
                          ? new Date(puData.status.lastCheck).toLocaleString('ru-RU')
                          : 'Неизвестно'
                      }</p>
                    </div>
                  ) : puData.status.status === 'pending_recheck' ? (
                    <div className="pending-state">
                      <div className="pending-icon">⏳</div>
                      <h4>Ожидает перепроверки АСКУЭ</h4>
                      <p>Мероприятия выполнены РЭС, требуется загрузить новый файл для проверки</p>
                    </div>
                  ) : (
                    <div className="not-checked-state">
                      <div className="not-checked-icon">❓</div>
                      <h4>Не проверялся</h4>
                      <p>Для этого ПУ еще не загружались файлы для анализа</p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Вкладка истории загрузок */}
              {activeTab === 'uploads' && (
                <div className="tab-content">
                  {uploadHistory.length === 0 ? (
                    <p className="no-data">Нет истории загрузок</p>
                  ) : (
                    <div className="history-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Дата</th>
                            <th>Загрузил</th>
                            <th>Файл</th>
                            <th>Статус</th>
                            <th>Ошибка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadHistory.map((upload, idx) => (
                            <tr key={idx} className={upload.uploadStatus}>
                              <td>{new Date(upload.uploadedAt).toLocaleString('ru-RU')}</td>
                              <td>{upload.User?.fio || 'Неизвестно'}</td>
                              <td>{upload.fileName}</td>
                              <td>
                                <span className={`status-badge status-${upload.uploadStatus}`}>
                                  {upload.uploadStatus === 'success' ? '✅ Успешно' :
                                   upload.uploadStatus === 'duplicate' ? '🔄 Дубликат' :
                                   upload.uploadStatus === 'wrong_period' ? '📅 Неверный период' :
                                   '❌ Ошибка'}
                                </span>
                              </td>
                              <td className="error-cell">
                                {upload.hasErrors ? (
                                  <details>
                                    <summary>Показать ошибку</summary>
                                    <pre>{upload.errorSummary}</pre>
                                  </details>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              
              {/* Вкладка истории проверок */}
              {activeTab === 'checks' && (
                <div className="tab-content">
                  {checkHistory.length === 0 ? (
                    <p className="no-data">Нет истории проверок</p>
                  ) : (
                    <div className="history-timeline">
                      {checkHistory.map((check, idx) => (
                        <div key={idx} className="timeline-item">
                          <div className="timeline-date">
                            {new Date(check.initialCheckDate).toLocaleDateString('ru-RU')}
                          </div>
                          
                          <div className="timeline-content">
                            <div className="timeline-step error">
                              <h5>🔴 Обнаружена ошибка</h5>
                              <p>{check.initialError}</p>
                            </div>
                            
                            {check.workCompletedDate && (
                              <div className="timeline-step work">
                                <h5>🔧 Мероприятия выполнены</h5>
                                <p><strong>Дата:</strong> {new Date(check.workCompletedDate).toLocaleDateString('ru-RU')}</p>
                                <p><strong>Комментарий:</strong> {check.resComment}</p>
                                {check.attachments && check.attachments.length > 0 && (
                                  <p><strong>Файлов:</strong> {check.attachments.length}</p>
                                )}
                              </div>
                            )}
                            
                            {check.recheckDate && (
                              <div className={`timeline-step recheck ${check.recheckResult}`}>
                                <h5>{check.recheckResult === 'ok' ? '✅ Перепроверка успешна' : '❌ Ошибка не устранена'}</h5>
                                <p><strong>Дата:</strong> {new Date(check.recheckDate).toLocaleDateString('ru-RU')}</p>
                              </div>
                            )}
                            
                            <div className="timeline-status">
                              <strong>Текущий статус:</strong> {
                                check.status === 'awaiting_work' ? 'Ожидает мероприятий' :
                                check.status === 'awaiting_recheck' ? 'Ожидает перепроверки' :
                                'Завершено'
                              }
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="action-btn" onClick={onClose}>Закрыть</button>
          {user.role === 'admin' && (
            <button 
              className="danger-btn" 
              onClick={() => {
                onClose();
                handleClearPuHistory(puData.puNumber);
              }}
            >
              🗑️ Очистить историю
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ИСТОРИИ СИСТЕМЫ
// =====================================================

function SystemHistory() {
  const [activeTab, setActiveTab] = useState('uploads'); // uploads или checks
  const [uploads, setUploads] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const { user } = useContext(AuthContext);
  const [resList, setResList] = useState([]);
  
  // Фильтры
  const [filters, setFilters] = useState({
  puNumber: '',
  tpName: '',
  resId: user.role === 'admin' ? '' : user.resId, // ИЗМЕНЕНО - не-админы видят только свой РЭС
  dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  dateTo: new Date().toISOString().split('T')[0],
  fileType: '',
  status: ''
});

  useEffect(() => {
    loadResList();
  }, []);
  
  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };
  
  useEffect(() => {
    loadData();
  }, [activeTab, currentPage, filters]);
  
  const loadData = async () => {
  setLoading(true);
  try {
    if (activeTab === 'uploads') {
      const params = new URLSearchParams({
        page: currentPage,
        limit: 100,
        ...filters,
        resId: user.role === 'admin' ? filters.resId : user.resId // Принудительно для не-админов
      });
      
      const response = await api.get(`/api/history/uploads?${params}`);
      setUploads(response.data.uploads);
      setTotalPages(response.data.totalPages);
    } else {
      const params = new URLSearchParams({
        page: currentPage,
        limit: 100,
        puNumber: filters.puNumber,
        resId: user.role === 'admin' ? filters.resId : user.resId, // Принудительно для не-админов
        tpName: filters.tpName,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status
      });
      
      const response = await api.get(`/api/history/checks?${params}`);
      setChecks(response.data.checks);
      setTotalPages(response.data.totalPages);
    }
  } catch (error) {
    console.error('Error loading history:', error);
  } finally {
    setLoading(false);
  }
};
  
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };
  
  const exportToExcel = () => {
    const data = activeTab === 'uploads' ? uploads : checks;
    if (data.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }
    
    let exportData;
    if (activeTab === 'uploads') {
      exportData = uploads.map(upload => ({
        'Дата загрузки': new Date(upload.uploadedAt).toLocaleString('ru-RU'),
        'РЭС': upload.resName || '',
        'ТП': upload.tpName || '',
        'ВЛ': upload.vlName || '',
        'Номер ПУ': upload.puNumber,
        'Загрузил': upload.User?.fio || '',
        'Тип файла': upload.fileType,
        'Статус': upload.uploadStatus === 'success' ? 'Успешно' : 
                  upload.uploadStatus === 'duplicate' ? 'Дубликат' : 
                  upload.uploadStatus === 'wrong_period' ? 'Неверный период' : 'Ошибка',
        'Есть ошибки': upload.hasErrors ? 'Да' : 'Нет',
        'Текст ошибки': upload.errorSummary || ''
      }));
    } else {
      exportData = checks.map(check => ({
        'РЭС': check.ResUnit?.name || '',
        'ТП': check.tpName,
        'ВЛ': check.vlName,
        'Номер ПУ': check.puNumber,
        'Позиция': check.position === 'start' ? 'Начало' : 
                   check.position === 'middle' ? 'Середина' : 'Конец',
        'Дата обнаружения': new Date(check.initialCheckDate).toLocaleString('ru-RU'),
        'Первоначальная ошибка': check.initialError,
        'Дата выполнения работ': check.workCompletedDate ? 
          new Date(check.workCompletedDate).toLocaleString('ru-RU') : '',
        'Комментарий РЭС': check.resComment || '',
        'Дата перепроверки': check.recheckDate ? 
          new Date(check.recheckDate).toLocaleString('ru-RU') : '',
        'Результат': check.recheckResult === 'ok' ? 'Исправлено' : 
                     check.recheckResult === 'error' ? 'Не исправлено' : 'Ожидает',
        'Статус': check.status === 'awaiting_work' ? 'Ожидает мероприятий' :
                  check.status === 'awaiting_recheck' ? 'Ожидает перепроверки' : 'Завершено'
      }));
    }
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Устанавливаем ширину колонок
    const maxWidth = 50;
    const cols = Object.keys(exportData[0] || {}).map(() => ({ wch: maxWidth }));
    ws['!cols'] = cols;
    
    XLSX.utils.book_append_sheet(wb, ws, activeTab === 'uploads' ? 'История загрузок' : 'История проверок');
    
    const fileName = `История_${activeTab === 'uploads' ? 'загрузок' : 'проверок'}_${new Date().toLocaleDateString('ru-RU').split('.').join('-')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };
  
  return (
    <div className="system-history">
      <h2>История системы</h2>

      {user.role !== 'admin' && (
    <div className="res-indicator">
      <span>Показаны данные для: <strong>{user.resName}</strong></span>
    </div>
  )}

      
      <div className="history-tabs">
        <button 
          className={`tab-btn ${activeTab === 'uploads' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('uploads');
            setCurrentPage(1);
          }}
        >
          История загрузок
        </button>
        <button 
          className={`tab-btn ${activeTab === 'checks' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('checks');
            setCurrentPage(1);
          }}
        >
          История проверок
        </button>
      </div>
      
      <div className="history-filters">
        <div className="filter-row">
          <div className="filter-group">
            <label>Номер ПУ:</label>
            <input 
              type="text"
              value={filters.puNumber}
              onChange={(e) => handleFilterChange('puNumber', e.target.value)}
              placeholder="Поиск по ПУ"
            />
          </div>

          {/* ДОБАВИТЬ выбор РЭС */}
          <div className="filter-group">
            <label>РЭС:</label>
            <select 
              value={filters.resId}
              onChange={(e) => handleFilterChange('resId', e.target.value)}
              disabled={user.role !== 'admin'} // Не-админы видят только свой РЭС
            >
              <option value="">Все РЭС</option>
              {resList.map(res => (
                <option key={res.id} value={res.id}>{res.name}</option>
              ))}
            </select>
          </div>
          
          {activeTab === 'uploads' && (
            <>
              <div className="filter-group">
                <label>ТП:</label>
                <input 
                  type="text"
                  value={filters.tpName}
                  onChange={(e) => handleFilterChange('tpName', e.target.value)}
                  placeholder="Поиск по ТП"
                />
              </div>
              
              <div className="filter-group">
                <label>Тип файла:</label>
                <select 
                  value={filters.fileType}
                  onChange={(e) => handleFilterChange('fileType', e.target.value)}
                >
                  <option value="">Все типы</option>
                  <option value="rim_single">Счетчик РИМ</option>
                  <option value="nartis">Счетчик Нартис</option>
                  <option value="energomera">Счетчик Энергомера</option>
                </select>
              </div>
              
              <div className="filter-group">
                <label>Статус:</label>
                <select 
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                >
                  <option value="">Все статусы</option>
                  <option value="success">Успешно</option>
                  <option value="duplicate">Дубликат</option>
                  <option value="wrong_period">Неверный период</option>
                  <option value="error">Ошибка</option>
                </select>
              </div>
            </>
          )}
          
          {activeTab === 'checks' && (
  <>
    {/* ДОБАВИТЬ поле ТП для истории проверок */}
    <div className="filter-group">
      <label>ТП:</label>
      <input 
        type="text"
        value={filters.tpName}
        onChange={(e) => handleFilterChange('tpName', e.target.value)}
        placeholder="Поиск по ТП"
      />
    </div>

    <div className="filter-group">
      <label>Статус:</label>
      <select 
        value={filters.status}
        onChange={(e) => handleFilterChange('status', e.target.value)}
      >
        <option value="">Все статусы</option>
        <option value="awaiting_work">Ожидает мероприятий</option>
        <option value="awaiting_recheck">Ожидает перепроверки</option>
        <option value="completed">Завершено</option>
      </select>
    </div>
  </>
)}
</div>    
        
        <div className="filter-row">
          <div className="filter-group">
            <label>Период с:</label>
            <input 
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
            />
          </div>
          
          <div className="filter-group">
            <label>по:</label>
            <input 
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
            />
          </div>
          
          <button className="export-btn" onClick={exportToExcel}>
            📊 Экспорт в Excel
          </button>
        </div>
      </div>
      
      <div className="history-content">
        {loading ? (
          <div className="loading">Загрузка истории...</div>
        ) : (
          <>
            {activeTab === 'uploads' && (
              <div className="history-table">
                <table>
                  <thead>
                    <tr>
                      <th>Дата загрузки</th>
                      <th>РЭС</th>
                      <th>ТП</th>
                      <th>ВЛ</th>
                      <th>ПУ №</th>
                      <th>Загрузил</th>
                      <th>Тип</th>
                      <th>Статус</th>
                      <th>Ошибка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((upload, idx) => (
                      <tr key={idx} className={upload.uploadStatus}>
                        <td>{new Date(upload.uploadedAt).toLocaleString('ru-RU')}</td>
                        <td>{upload.resName || '—'}</td>
                        <td>{upload.tpName || '—'}</td>
                        <td>{upload.vlName || '—'}</td>
                        <td><strong>{upload.puNumber}</strong></td>
                        <td>{upload.User?.fio || 'Неизвестно'}</td>
                        <td>{upload.fileType}</td>
                        <td>
                          <span className={`status-badge status-${upload.uploadStatus}`}>
                            {upload.uploadStatus === 'success' ? '✅' :
                             upload.uploadStatus === 'duplicate' ? '🔄' :
                             upload.uploadStatus === 'wrong_period' ? '📅' : '❌'}
                          </span>
                        </td>
                        <td className="error-cell">
                          {upload.hasErrors && (
                            <details>
                              <summary>Показать</summary>
                              <pre>{upload.errorSummary}</pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {activeTab === 'checks' && (
              <div className="history-table">
                <table>
                  <thead>
                    <tr>
                      <th>РЭС</th>
                      <th>ТП</th>
                      <th>ВЛ</th>
                      <th>ПУ №</th>
                      <th>Дата ошибки</th>
                      <th>Ошибка</th>
                      <th>Мероприятия</th>
                      <th>Перепроверка</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((check, idx) => (
                      <tr key={idx}>
                        <td>{check.ResUnit?.name}</td>
                        <td>{check.tpName}</td>
                        <td>{check.vlName}</td>
                        <td><strong>{check.puNumber}</strong></td>
                        <td>{new Date(check.initialCheckDate).toLocaleDateString('ru-RU')}</td>
                        <td className="error-cell">
                          <details>
                            <summary>Показать</summary>
                            <pre>{check.initialError}</pre>
                          </details>
                        </td>
                        <td>
                          {check.workCompletedDate ? (
                            <>
                              <div>{new Date(check.workCompletedDate).toLocaleDateString('ru-RU')}</div>
                              <small>{check.resComment}</small>
                            </>
                          ) : '—'}
                        </td>
                        <td>
                          {check.recheckDate ? (
                            <span className={check.recheckResult === 'ok' ? 'status-ok' : 'status-error'}>
                              {check.recheckResult === 'ok' ? '✅' : '❌'}
                              {' ' + new Date(check.recheckDate).toLocaleDateString('ru-RU')}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span className={`status-badge status-${check.status}`}>
                            {check.status === 'awaiting_work' ? 'Ожидает работ' :
                             check.status === 'awaiting_recheck' ? 'Ожидает проверки' :
                             'Завершено'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* Пагинация */}
            {totalPages > 1 && (
              <div className="pagination">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  ← Назад
                </button>
                <span>Страница {currentPage} из {totalPages}</span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Вперед →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Analytics() {
  const [analytics, setAnalytics] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const { user } = useContext(AuthContext);
  
  useEffect(() => {
    loadAnalytics();
  }, [dateFrom, dateTo]);
  
  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/analytics/summary', {
        params: { dateFrom, dateTo }
      });
      setAnalytics(response.data.analytics);
      setTotals(response.data.totals);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const exportToExcel = () => {
    const data = analytics.map(row => ({
      'РЭС': row.resName,
      'Всего ТП': row.tpCount,
      'Всего ПУ': row.totalPuCount,
      'Загружено файлов': row.uploadedCount,
      'Процент охвата': row.percentage + '%',
      'Соответствует ГОСТ': row.okCount,
      'Не соответствует ГОСТ': row.errorCount
    }));
    
    // Добавляем итоги
    if (user.role === 'admin') {
      data.push({
        'РЭС': 'ИТОГО',
        'Всего ТП': totals.tpCount,
        'Всего ПУ': totals.totalPuCount,
        'Загружено файлов': totals.uploadedCount,
        'Процент охвата': totals.totalPuCount > 0 
          ? Math.round((totals.uploadedCount / totals.totalPuCount) * 100) + '%'
          : '0%',
        'Соответствует ГОСТ': totals.okCount,
        'Не соответствует ГОСТ': totals.errorCount
      });
    }
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Аналитика');
    XLSX.writeFile(wb, `Аналитика_${new Date().toLocaleDateString('ru-RU')}.xlsx`);
  };
  
  if (loading) return <div className="loading">Загрузка аналитики...</div>;
  
  return (
    <div className="analytics-container">
      <h2>📈 Аналитика по загрузкам</h2>
      
      <div className="analytics-controls">
        <div className="control-group">
          <label>Период с:</label>
          <input 
            type="date" 
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="control-group">
          <label>по:</label>
          <input 
            type="date" 
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <button onClick={exportToExcel} className="export-btn">
          📊 Экспорт в Excel
        </button>
      </div>
      
      <div className="analytics-table">
        <table>
          <thead>
            <tr>
              <th>РЭС</th>
              <th>Всего ТП</th>
              <th>Всего ПУ</th>
              <th>Загружено файлов</th>
              <th>% охвата</th>
              <th>Соответствует ГОСТ</th>
              <th>Не соответствует ГОСТ</th>
            </tr>
          </thead>
          <tbody>
            {analytics.map(row => (
              <tr key={row.resId}>
                <td>{row.resName}</td>
                <td>{row.tpCount}</td>
                <td>{row.totalPuCount}</td>
                <td>{row.uploadedCount}</td>
                <td>
                  <div className="progress-cell">
                    <div className="progress-bar-small">
                      <div 
                        className="progress-fill-small"
                        style={{ width: `${row.percentage}%` }}
                      />
                    </div>
                    <span>{row.percentage}%</span>
                  </div>
                </td>
                <td className="ok-count">{row.okCount}</td>
                <td className="error-count">{row.errorCount}</td>
              </tr>
            ))}
            {user.role === 'admin' && (
              <tr className="totals-row">
                <td><strong>ИТОГО</strong></td>
                <td><strong>{totals.tpCount}</strong></td>
                <td><strong>{totals.totalPuCount}</strong></td>
                <td><strong>{totals.uploadedCount}</strong></td>
                <td>
                  <strong>
                    {totals.totalPuCount > 0 
                      ? Math.round((totals.uploadedCount / totals.totalPuCount) * 100) 
                      : 0}%
                  </strong>
                </td>
                <td className="ok-count"><strong>{totals.okCount}</strong></td>
                <td className="error-count"><strong>{totals.errorCount}</strong></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [activeSection, setActiveSection] = useState('structure');
  const [selectedRes, setSelectedRes] = useState(null);
  const [resList, setResList] = useState([]);

  // Оптимизированная проверка токена
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/api/auth/me')
        .then(response => {
          setUser(response.data.user);
          setSelectedRes(response.data.user.resId);
        })
        .catch(() => {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUser({
              id: payload.id,
              role: payload.role,
              resId: payload.resId
            });
            setSelectedRes(payload.resId);
          } catch (error) {
            localStorage.removeItem('token');
          }
        });
    }
  }, []);

  useEffect(() => {
    if (user && user.role === 'admin') {
      loadResList();
    }
  }, [user]);

  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };

  const handleLogin = useCallback((userData) => {
    setUser({
      id: userData.id,
      fio: userData.fio,
      role: userData.role,
      resId: userData.resId,
      resName: userData.resName
    });
    if (userData.resId) {
      setSelectedRes(userData.resId);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setSelectedRes(null);
  };

  if (!user) {
    return <LoginForm onLogin={handleLogin} />;
  }

const renderContent = () => {
  switch (activeSection) {
    case 'structure':
      return <NetworkStructure />;
    case 'upload':
      return <FileUpload />;
    case 'tech_pending':
      return <Notifications filterType="error" onSectionChange={setActiveSection} selectedRes={selectedRes} />;
    case 'askue_pending':
      return <Notifications filterType="pending_askue" onSectionChange={setActiveSection} selectedRes={selectedRes} />;
    case 'problem_vl':
      return <ProblemVL />;
    case 'documents':
      return <UploadedDocuments />;
    case 'reports':
      return <Reports />;
    case 'settings':
      return <Settings />;
    case 'history':
      return <SystemHistory />;
    case 'analytics':  
      return <Analytics />;
    default:
      return <NetworkStructure />;
  }
};

  return (
    <AuthContext.Provider value={{ user, selectedRes }}>
      <div className="app">
        <MainMenu 
          activeSection={activeSection} 
          onSectionChange={setActiveSection}
          userRole={user.role}
        />
        
        <div className="main-content">
          <header className="app-header">
            <div className="header-left">
              <h1>Система контроля уровня напряжения в сетях 0,4 кВ</h1>
              {user.role === 'admin' && activeSection !== 'history' && activeSection !== 'analytics' && (
                <select 
                  value={selectedRes || ''}
                  onChange={(e) => setSelectedRes(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">Все РЭСы</option>
                  {resList.map(res => (
                    <option key={res.id} value={res.id}>{res.name}</option>
                  ))}
                </select>
              )}
              {user.resId && (
                <span className="res-name">
                  {resList.find(r => r.id === user.resId)?.name || user.resName}
                </span>
              )}
            </div>
            
            <div className="header-right">
              <span>{user.fio}</span>
              <span className="user-role">
                ({user.role === 'admin' ? 'Администратор' : 
                  user.role === 'uploader' ? 'Загрузчик' : 'Ответственный'})
              </span>
              <button onClick={handleLogout} className="logout-btn">
                Выйти
              </button>
            </div>
          </header>
          
          <main className="content">
            {renderContent()}
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
