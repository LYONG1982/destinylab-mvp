import Taro from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import "../../components/registration.scss";
export default function Privacy() {
  return (
    <View className="reg-page">
      <View className="reg-card">
        <Text className="reg-card-title">活动报名须知</Text>
        <Text className="reg-copy">
          信息处理主体：{process.env.TARO_APP_PRIVACY_OWNER || "开发包待配置"}
        </Text>
        <Text className="reg-copy">
          联系渠道：{process.env.TARO_APP_PRIVACY_CONTACT || "开发包待配置"}
        </Text>
        <Text className="reg-copy">
          本活动仅面向年满18周岁的成年人。微信身份用于找回本人的报名和活动进度；报名与签到分别进行，现场工作人员核验六位凭证后可进入互动。
        </Text>
        <Text className="reg-card-title">资料与照片</Text>
        <Text className="reg-copy">
          姓名、电话及完整生日保存在私人档案，不进入公开卡牌或分享参数。资料可随时编辑。选择同舟专业服务后，授权资料和相册会提供给同舟婚恋工作人员；头像上屏、互动展示按对应页面的公开选项执行。
        </Text>
        <Text className="reg-copy">
          用于活动互动的公开昵称和头像会提交至微信内容安全接口检测。头像检测通过前不更新展示；检测中的照片仅通过短期授权链接供检测服务读取。报名私人相册不会因上传而自动公开。
        </Text>
        <Text className="reg-copy">
          需处理个人信息或报名问题，请联系活动现场工作人员。具体信息处理主体、联系方式与保存期限，请查看微信平台配置的隐私保护指引。
        </Text>
        <Button
          className="reg-primary"
          onClick={() => Taro.openPrivacyContract()}
        >
          查看微信隐私保护指引
        </Button>
      </View>
    </View>
  );
}
