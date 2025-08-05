// =====================================================
// ПОЛНЫЙ BACKEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Всё в одном файле для удобства переноса между чатами
// =====================================================

// Устанавливаем кодировку
process.env.LANG = 'ru_RU.UTF-8';
process.env.LC_ALL = 'ru_RU.UTF-8';
process.env.NODE_OPTIONS = '--encoding=utf-8';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');

// =====================================================
// КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// =====================================================

require('dotenv').config();
const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
// Health check для Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RES Management Backend is running',
    version: '1.0.0'
  });
});
// Создаем папку uploads если её нет
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// =====================================================
// ПОДКЛЮЧЕНИЕ К БД (PostgreSQL на Render)
// =====================================================

const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/dbname', {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false,
    charset: 'utf8',
    client_encoding: 'UTF8'
  },
  logging: false
});

// =====================================================
// МОДЕЛИ ДАННЫХ
// =====================================================

// 1. Модель РЭС (районов)
const ResUnit = sequelize.define('ResUnit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
});

// 2. Модель пользователей
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fio: {
    type: DataTypes.STRING,
    allowNull: false
  },
  login: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'uploader', 'res_responsible'),
    allowNull: false
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// 3. Модель структуры сети (ТП и ВЛ)
const NetworkStructure = sequelize.define('NetworkStructure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  endPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  middlePu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastUpdate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// 4. Модель статусов ПУ (приборов учета)
const PuStatus = sequelize.define('PuStatus', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('not_checked', 'checked_ok', 'checked_error', 'empty'),
    defaultValue: 'not_checked'
  },
  errorDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastCheck: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// 5. Модель уведомлений
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fromUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  toUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('error', 'success', 'info', 'pending_check'),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// 6. Модель истории загрузок
const UploadHistory = sequelize.define('UploadHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileType: {
    type: DataTypes.ENUM('rim_single', 'rim_mass', 'nartis', 'energomera'),
    allowNull: false
  },
  processedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  errorCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('processing', 'completed', 'failed'),
    defaultValue: 'processing'
  }
});

// =====================================================
// СВЯЗИ МЕЖДУ МОДЕЛЯМИ
// =====================================================

User.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.hasMany(PuStatus, { foreignKey: 'networkStructureId' });
PuStatus.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
Notification.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });
Notification.belongsTo(ResUnit, { foreignKey: 'resId' });
Notification.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
UploadHistory.belongsTo(User, { foreignKey: 'userId' });
UploadHistory.belongsTo(ResUnit, { foreignKey: 'resId' });

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

// Хеширование паролей
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

// Валидация пароля
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки ролей
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
};

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

// Email сервис
const createEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.mail.ru',
    port: process.env.MAIL_PORT || 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
};

// =====================================================
// API РОУТЫ
// =====================================================

// 1. АВТОРИЗАЦИЯ
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    const user = await User.findOne({ 
      where: { login },
      include: [ResUnit]
    });
    
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        resId: user.resId,
        fio: user.fio 
      },
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        fio: user.fio,
        role: user.role,
        resId: user.resId,
        resName: user.ResUnit?.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. ПОЛУЧЕНИЕ СПИСКА РЭС
app.get('/api/res/list', authenticateToken, async (req, res) => {
  try {
    const resList = await ResUnit.findAll();
    res.json(resList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ПОЛУЧЕНИЕ СТРУКТУРЫ СЕТИ
app.get('/api/network/structure/:resId?', authenticateToken, async (req, res) => {
  try {
    const resId = req.params.resId || req.user.resId;
    
    // Если не админ, может видеть только свой РЭС
    if (req.user.role !== 'admin' && resId != req.user.resId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // НОВОЕ: Адлерский РЭС (id=2) также видит СИРИУС (id=8)
    let whereClause = {};
    if (resId) {
      if (resId == 2 || req.user.resId == 2) {
        // Если смотрим Адлерский РЭС или пользователь из Адлерского - показываем и СИРИУС
        whereClause = { resId: { [Op.in]: [2, 8] } };
      } else {
        whereClause = { resId };
      }
    }
    
    const structures = await NetworkStructure.findAll({
      where: whereClause,
      include: [
        {
          model: PuStatus,
          required: false,
          attributes: ['id', 'puNumber', 'position', 'status', 'errorDetails', 'lastCheck'] // явно указываем поля
        },
        ResUnit
      ],
      order: [['tpName', 'ASC'], ['vlName', 'ASC']]
    });
    
    res.json(structures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ЗАГРУЗКА СТРУКТУРЫ СЕТИ (только админ)
app.post('/api/network/upload-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      // Парсим данные и создаем записи
      for (const row of data) {
        const resName = row['РЭС'] || row['RES'];
        const res = await ResUnit.findOne({ where: { name: resName } });
        
        if (res) {
          // Создаем или обновляем структуру
          await NetworkStructure.upsert({
            resId: res.id,
            tpName: row['Наименование ТП'] || row['TP'],
            vlName: row['Наименование ВЛ'] || row['VL'],
            startPu: row['Начало'] || row['Start'] || null,
            endPu: row['Конец'] || row['End'] || null,
            middlePu: row['Середина'] || row['Middle'] || null
          });
        }
      }
      
      // Удаляем файл после обработки
      fs.unlinkSync(req.file.path);
      
      res.json({ message: 'Structure uploaded successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 5. ЗАГРУЗКА ФАЙЛОВ ДЛЯ АНАЛИЗА
app.post('/api/upload/analyze',
  authenticateToken,
  checkRole(['admin', 'uploader']),
  upload.single('file'),
  async (req, res) => {
    try {
      const { type } = req.body;
      const userId = req.user.id;
      const resId = req.user.role === 'admin' ? req.body.resId : req.user.resId;
      
      // Создаем запись в истории
      const uploadRecord = await UploadHistory.create({
        userId,
        resId,
        fileName: req.file.originalname,
        fileType: type,
        status: 'processing'
      });
      
      // Запускаем анализ (заглушка - замени на реальный Python скрипт)
      const analysisResult = await analyzeFile(req.file.path, type);
      
      // Обновляем статусы ПУ
      for (const result of analysisResult.processed) {
        await updatePuStatus(result.puNumber, result.status, result.error);
      }
      
      // Обновляем историю
      await uploadRecord.update({
        processedCount: analysisResult.processed.length,
        errorCount: analysisResult.errors.length,
        status: 'completed'
      });
      
      // Отправляем уведомления
      if (analysisResult.errors.length > 0) {
        await createNotifications(userId, resId, analysisResult.errors);
      }
      
      res.json({
        message: 'File processed successfully',
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 4.5 ЗАГРУЗКА ПОЛНОЙ СТРУКТУРЫ СЕТИ С ОБНОВЛЕНИЕМ
app.post('/api/network/upload-full-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      // Маппинг РЭСов
      let processed = 0;
      let errors = [];
      
      // Опционально: очищаем старые данные
      if (req.body.clearOld === 'true') {
        await NetworkStructure.destroy({ where: {}, transaction });
      }
      
      // Обрабатываем каждую строку
      for (const row of data) {
        try {
          // Ищем РЭС по полному имени из Excel
          const resName = row['РЭС'];
          const res = await ResUnit.findOne({ 
            where: { name: resName },
            transaction 
          });
          
          if (!res) {
            errors.push(`Неизвестный РЭС: ${resName}`);
            continue;
          }
          
          // Создаем или обновляем запись
          await NetworkStructure.upsert({
            resId: res.id,  // Используем найденный ID из базы
            tpName: row['ТП'] || '',
            vlName: row['Фидер'] || '',
            startPu: row['Начало'] ? String(row['Начало']) : null,
            endPu: row['Конец'] ? String(row['Конец']) : null,
            middlePu: row['Середина'] ? String(row['Середина']) : null
          }, {
            transaction
          });
          
          processed++;
          
          // Создаем статусы для новых ПУ
          const positions = [
            { pu: row['Начало'], pos: 'start' },
            { pu: row['Конец'], pos: 'end' },
            { pu: row['Середина'], pos: 'middle' }
          ];
          
          for (const { pu, pos } of positions) {
            if (pu) {
              await PuStatus.findOrCreate({
                where: { puNumber: String(pu) },
                defaults: {
                  position: pos,
                  status: 'not_checked'
                },
                transaction
              });
            }
          }
          
        } catch (err) {
          errors.push(`Ошибка в строке ${row['ТП']}-${row['Фидер']}: ${err.message}`);
        }
      }
      
      await transaction.commit();
      
      // Удаляем файл
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        message: `Загружено ${processed} записей из ${data.length}`,
        processed,
        total: data.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : [] // Первые 10 ошибок
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// 6. ПОЛУЧЕНИЕ УВЕДОМЛЕНИЙ
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const whereClause = req.user.role === 'admin' 
      ? {} 
      : { toUserId: req.user.id };
    
    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'fromUser' },
        { model: User, as: 'toUser' },
        ResUnit,
        NetworkStructure
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. ОТМЕТИТЬ УВЕДОМЛЕНИЕ КАК ПРОЧИТАННОЕ
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await Notification.update(
      { isRead: true },
      { where: { id: req.params.id } }
    );
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ОТПРАВКА УВЕДОМЛЕНИЯ О ВЫПОЛНЕННЫХ МЕРОПРИЯТИЯХ
app.post('/api/notifications/work-completed', authenticateToken, checkRole(['res_responsible']), async (req, res) => {
  try {
    const { networkStructureId, message } = req.body;
    
    // Найти всех загрузчиков этого РЭС
    const uploaders = await User.findAll({
      where: {
        resId: req.user.resId,
        role: 'uploader'
      }
    });
    
    // Создать уведомления для каждого загрузчика
    for (const uploader of uploaders) {
      await Notification.create({
        fromUserId: req.user.id,
        toUserId: uploader.id,
        resId: req.user.resId,
        networkStructureId,
        type: 'info',
        message: `Мероприятия выполнены: ${message}`
      });
    }
    
    res.json({ message: 'Notifications sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. ПОЛУЧЕНИЕ ОТЧЕТОВ
app.get('/api/reports/summary', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate, resId } = req.query;
    
    const whereClause = {};
    if (startDate) whereClause.createdAt = { [Op.gte]: new Date(startDate) };
    if (endDate) whereClause.createdAt = { ...whereClause.createdAt, [Op.lte]: new Date(endDate) };
    if (resId) whereClause.resId = resId;
    
    const uploadStats = await UploadHistory.findAll({
      where: whereClause,
      include: [User, ResUnit],
      order: [['createdAt', 'DESC']]
    });
    
    const errorStats = await PuStatus.count({
      where: { status: 'checked_error' },
      include: [{
        model: NetworkStructure,
        where: resId ? { resId } : {}
      }]
    });
    
    const pendingStats = await NetworkStructure.count({
      where: resId ? { resId } : {},
      include: [{
        model: PuStatus,
        where: { status: 'checked_error' }
      }]
    });
    
    res.json({
      uploads: uploadStats,
      totalErrors: errorStats,
      pendingChecks: pendingStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ АНАЛИЗА
// =====================================================

// Заглушка для анализа файлов (замени на реальный Python)
async function analyzeFile(filePath, type) {
  // Здесь будет вызов Python скрипта
  // const result = await runPythonScript(type, filePath);
  
  // Пока возвращаем моковые данные
  return {
    processed: [
      { puNumber: '123', status: 'checked_ok', error: null },
      { puNumber: '456', status: 'checked_error', error: 'Invalid readings' }
    ],
    errors: [
      { puNumber: '456', error: 'Invalid readings' }
    ]
  };
}

// Обновление статуса ПУ
async function updatePuStatus(puNumber, status, errorDetails) {
  const pu = await PuStatus.findOne({ where: { puNumber } });
  if (pu) {
    await pu.update({
      status,
      errorDetails,
      lastCheck: new Date()
    });
  }
}

// Создание уведомлений об ошибках
async function createNotifications(fromUserId, resId, errors) {
  const responsibles = await User.findAll({
    where: {
      resId,
      role: 'res_responsible'
    }
  });
  
  for (const responsible of responsibles) {
    await Notification.create({
      fromUserId,
      toUserId: responsible.id,
      resId,
      type: 'error',
      message: `Обнаружено ${errors.length} ошибок при проверке`
    });
  }
}

// =====================================================
// ИНИЦИАЛИЗАЦИЯ БД И ЗАПУСК СЕРВЕРА
// =====================================================

async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    
    // Синхронизация моделей
    await sequelize.sync({ alter: true });
    
    // Создаем РЭСы если их нет
    const resCount = await ResUnit.count();
    if (resCount === 0) {
      const resList = [
        'Краснополянский РЭС',
        'Адлерский РЭС',
        'Хостинский РЭС',
        'Сочинский РЭС',
        'Дагомысский РЭС',
        'Лазаревский РЭС',
        'Туапсинский РЭС'
      ];
      
      for (const resName of resList) {
        await ResUnit.create({ name: resName });
      }
      console.log('RES units created');
    }
    
    // Создаем СИРИУС <-- ВОТ ТУТ ВСТАВЛЯЕШЬ
    try {
      const [sirius, created] = await ResUnit.findOrCreate({
        where: { name: 'СИРИУС' },
        defaults: { name: 'СИРИУС' }
      });
      console.log('SIRIUS added/checked', created ? 'created' : 'exists');
    } catch (err) {
      console.error('Error creating SIRIUS:', err);
    }
    
    console.log('Database initialization complete');
    
    // Создаем админа если его нет
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      await User.create({
        fio: 'Администратор',
        login: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@res.ru'
      });
      console.log('Admin user created');
    }
    
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
} // <-- Конец функции

// Запуск сервера
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

// Обработка ошибок
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
