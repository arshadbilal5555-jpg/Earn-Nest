'use strict';

const crypto = require('crypto');

const users = new Map();
const resetCodes = new Map();
const adminSessions = new Map();

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@earnnest.com';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || '';

/* =========================
   DEFAULT ADMIN
========================= */

users.set(ADMIN_EMAIL.toLowerCase(), {
  id: 'admin-001',
  name: 'EarnNest Admin',
  username: 'admin',
  email: ADMIN_EMAIL.toLowerCase(),
  phone: '',
  password: ADMIN_PASSWORD,
  role: 'admin',
  coins: 0
});

/* =========================
   HELPERS
========================= */

function send(res,status,data){

  res.statusCode=status;

  res.setHeader(
    'Content-Type',
    'application/json'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.end(JSON.stringify(data));
}

function readBody(req){

  return new Promise((resolve,reject)=>{

    let body='';

    req.on('data',chunk=>{
      body+=chunk;

      if(body.length>1024*1024){
        reject(new Error('Request too large'));
        req.destroy();
      }
    });

    req.on('end',()=>{

      try{
        resolve(body?JSON.parse(body):{});
      }catch{
        reject(new Error('Invalid JSON'));
      }

    });

    req.on('error',reject);

  });
}

function clean(value){
  return String(value||'').trim();
}

function email(value){
  return clean(value).toLowerCase();
}

function createToken(){
  return crypto.randomUUID();
}

function getBearer(req){

  const header=req.headers.authorization||'';

  if(!header.startsWith('Bearer ')){
    return '';
  }

  return header.slice(7).trim();
}

function getAdmin(req){

  const token=getBearer(req);

  if(!token){
    return null;
  }

  const session=adminSessions.get(token);

  if(!session){
    return null;
  }

  if(session.expiresAt<Date.now()){

    adminSessions.delete(token);

    return null;
  }

  const user=users.get(session.email);

  if(!user || user.role!=='admin'){
    return null;
  }

  return user;
}

/* =========================
   MAIN
========================= */

module.exports=async(req,res)=>{

  if(req.method==='OPTIONS'){
    res.statusCode=204;

    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,OPTIONS'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    return res.end();
  }

  const path=req.url.split('?')[0];

  /* HEALTH */

  if(req.method==='GET' && path==='/api/health'){

    return send(res,200,{
      ok:true,
      success:true,
      service:'EarnNest API',
      status:'running'
    });

  }

  /* LOGIN */

  if(req.method==='POST' && path==='/api/login'){

    try{

      const body=await readBody(req);

      const login=email(
        body.login ||
        body.email ||
        body.username
      );

      const password=String(
        body.password||''
      );

      if(!login || !password){

        return send(res,400,{
          success:false,
          message:'Email/username and password are required'
        });

      }

      let user=users.get(login);

      if(!user){

        for(const item of users.values()){

          if(
            item.username &&
            item.username.toLowerCase()===login
          ){
            user=item;
            break;
          }

        }

      }

      if(!user || user.password!==password){

        return send(res,401,{
          success:false,
          message:'Invalid email/username or password'
        });

      }

      let token=null;

      if(user.role==='admin'){

        token=createToken();

        adminSessions.set(token,{
          email:user.email,
          expiresAt:Date.now()+24*60*60*1000
        });

      }

      return send(res,200,{
        success:true,
        message:'Login successful',
        token,
        user:{
          id:user.id,
          name:user.name,
          username:user.username,
          email:user.email,
          phone:user.phone,
          role:user.role,
          coins:user.coins||0
        }
      });

    }catch(error){

      return send(res,400,{
        success:false,
        message:error.message||'Login failed'
      });

    }

  }

  /* REGISTER */

  if(req.method==='POST' && path==='/api/register'){

    try{

      const body=await readBody(req);

      const name=clean(body.name);
      const username=clean(body.username).toLowerCase();
      const userEmail=email(body.email);
      const phone=clean(body.phone);
      const password=String(body.password||'');
      const confirm=String(body.confirmPassword||'');

      if(
        !name ||
        !username ||
        !userEmail ||
        !phone ||
        !password ||
        !confirm
      ){

        return send(res,400,{
          success:false,
          message:'All fields are required'
        });

      }

      if(password.length<6){

        return send(res,400,{
          success:false,
          message:'Password must be at least 6 characters'
        });

      }

      if(password!==confirm){

        return send(res,400,{
          success:false,
          message:'Passwords do not match'
        });

      }

      if(users.has(userEmail)){

        return send(res,409,{
          success:false,
          message:'Email already registered'
        });

      }

      for(const item of users.values()){

        if(
          item.username &&
          item.username.toLowerCase()===username
        ){

          return send(res,409,{
            success:false,
            message:'Username already registered'
          });

        }

      }

      const user={
        id:'user-'+Date.now(),
        name,
        username,
        email:userEmail,
        phone,
        password,
        role:'user',
        coins:0
      };

      users.set(userEmail,user);

      return send(res,201,{
        success:true,
        message:'Account created successfully',
        user:{
          id:user.id,
          name:user.name,
          username:user.username,
          email:user.email,
          phone:user.phone,
          role:user.role,
          coins:0
        }
      });

    }catch(error){

      return send(res,400,{
        success:false,
        message:error.message||'Registration failed'
      });

    }

  }

  /* FORGOT PASSWORD */

  if(
    req.method==='POST' &&
    path==='/api/forgot-password'
  ){

    try{

      const body=await readBody(req);

      const userEmail=email(body.email);

      if(!userEmail){

        return send(res,400,{
          success:false,
          message:'Email is required'
        });

      }

      const user=users.get(userEmail);

      if(!user){

        return send(res,404,{
          success:false,
          message:'No account found with this email'
        });

      }

      const code=
        String(
          Math.floor(
            100000+
            Math.random()*900000
          )
        );

      resetCodes.set(userEmail,{
        code,
        expiresAt:Date.now()+10*60*1000
      });

      /*
        For testing, return code.
        Production mein isko email provider se send karna hoga.
      */

      return send(res,200,{
        success:true,
        message:'Reset code generated',
        testingCode:code
      });

    }catch(error){

      return send(res,400,{
        success:false,
        message:error.message||'Unable to generate reset code'
      });

    }

  }

  /* RESET PASSWORD */

  if(
    req.method==='POST' &&
    path==='/api/reset-password'
  ){

    try{

      const body=await readBody(req);

      const userEmail=email(body.email);
      const code=clean(body.code);
      const password=String(body.newPassword||'');
      const confirm=String(body.confirmPassword||'');

      const record=resetCodes.get(userEmail);

      if(!record){

        return send(res,400,{
          success:false,
          message:'Reset code not found'
        });

      }

      if(record.expiresAt<Date.now()){

        resetCodes.delete(userEmail);

        return send(res,400,{
          success:false,
          message:'Reset code has expired'
        });

      }

      if(record.code!==code){

        return send(res,400,{
          success:false,
          message:'Invalid verification code'
        });

      }

      if(password.length<6){

        return send(res,400,{
          success:false,
          message:'Password must be at least 6 characters'
        });

      }

      if(password!==confirm){

        return send(res,400,{
          success:false,
          message:'Passwords do not match'
        });

      }

      const user=users.get(userEmail);

      if(!user){

        return send(res,404,{
          success:false,
          message:'Account not found'
        });

      }

      user.password=password;

      resetCodes.delete(userEmail);

      return send(res,200,{
        success:true,
        message:'Password reset successfully'
      });

    }catch(error){

      return send(res,400,{
        success:false,
        message:error.message||'Password reset failed'
      });

    }

  }

  /* ADMIN STATS */

  if(
    req.method==='GET' &&
    path==='/api/admin/stats'
  ){

    const admin=getAdmin(req);

    if(!admin){

      return send(res,403,{
        success:false,
        message:'Admin access required'
      });

    }

    const allUsers=
      Array.from(users.values());

    const normalUsers=
      allUsers.filter(
        user=>user.role!=='admin'
      );

    const totalCoins=
      normalUsers.reduce(
        (sum,user)=>
          sum+Number(user.coins||0),
        0
      );

    return send(res,200,{
      success:true,

      stats:{
        totalUsers:normalUsers.length,
        totalCoins,
        totalWithdrawals:0,
        pendingKyc:0
      },

      users:
        normalUsers.map(user=>({
          id:user.id,
          name:user.name,
          username:user.username,
          email:user.email,
          phone:user.phone,
          role:user.role,
          coins:user.coins||0
        }))

    });

  }

  /* ADMIN LOGOUT */

  if(
    req.method==='POST' &&
    path==='/api/admin/logout'
  ){

    const token=getBearer(req);

    if(token){
      adminSessions.delete(token);
    }

    return send(res,200,{
      success:true,
      message:'Logged out'
    });

  }

  return send(res,404,{
    success:false,
    message:'API endpoint not found'
  });

};
