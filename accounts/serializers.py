from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Profile

class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=True)
    password = serializers.CharField(write_only=True, min_length=6)
    login = serializers.CharField(write_only=True, max_length=32)
    avatar = serializers.ImageField(required=False, allow_null=True)
    
    class Meta:
        model = User
        fields = ("username", "email", "password", "login", "avatar")
    
    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Пользователь с таким username уже существует")
        return value
    
    def validate_login(self, value):
        if Profile.objects.filter(login__iexact=value).exists():
            raise serializers.ValidationError("Пользователь с таким логином уже существует")
        return value
    
    def create(self, validated_data):
        avatar = validated_data.pop('avatar', None)
        login = validated_data.pop('login')
        
        user = User.objects.create_user(
            username=validated_data["username"], 
            email=validated_data["email"], 
            password=validated_data["password"]
        )
        
        user.profile.login = login
        if avatar:
            user.profile.avatar = avatar
        user.profile.save()
        
        return user

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = "__all__"